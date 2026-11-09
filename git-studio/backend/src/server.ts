// Git Studio backend: a REST API for git / GitHub / AI work, plus one WebSocket
// (/ws) for live command logs and terminals. Listens on 127.0.0.1 only.
import express, { type NextFunction, type Request, type Response } from 'express'
import { createServer, type IncomingMessage } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { promises as fs, existsSync } from 'fs'
import { spawn } from 'child_process'
import os from 'os'
import path from 'path'
import * as git from './git'
import * as gh from './github'
import * as store from './store'
import * as pty from './pty'
import * as ai from './ai'
import type { LogEntry, PtyKind } from './types'

const PORT = Number(process.env.PORT || 4317)
const HOST = '127.0.0.1'
const FRONTEND_DEV_PORT = Number(process.env.FRONTEND_PORT || 5173)

// ------------------------------------------------------------------ security
// The API can run commands on this computer, so only pages served from this
// machine may call it. This blocks other websites (and DNS-rebinding tricks).
const allowedHosts = new Set([
  `localhost:${PORT}`, `127.0.0.1:${PORT}`, `localhost:${FRONTEND_DEV_PORT}`, `127.0.0.1:${FRONTEND_DEV_PORT}`
])
const allowedOrigins = new Set([...allowedHosts].map((h) => `http://${h}`))

function trusted(req: IncomingMessage): boolean {
  const host = req.headers.host ?? ''
  const origin = req.headers.origin
  if (!allowedHosts.has(host)) return false
  if (origin && !allowedOrigins.has(origin)) return false
  return true
}

// ------------------------------------------------------------------ live events
const clients = new Set<WebSocket>()
const recentLogs: LogEntry[] = []

function broadcast(msg: object): void {
  const text = JSON.stringify(msg)
  for (const c of clients) if (c.readyState === WebSocket.OPEN) c.send(text)
}

git.setTokenGetter(store.token)
git.setLogSink((entry) => {
  const i = recentLogs.findIndex((x) => x.id === entry.id)
  if (i >= 0) recentLogs[i] = entry
  else { recentLogs.push(entry); if (recentLogs.length > 500) recentLogs.shift() }
  broadcast({ type: 'log', entry })
})

// ------------------------------------------------------------------ helpers
const app = express()
app.disable('x-powered-by')
app.use((req, res, next) => (trusted(req) ? next() : res.status(403).json({ error: 'Forbidden origin' })))
app.use(express.json({ limit: '20mb' }))

type Handler = (req: Request, res: Response) => Promise<unknown>
/** Wraps a handler: JSON { data } on success, { error } with status 400/404 on failure. */
const h = (fn: Handler) => async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await fn(req, res)
    if (!res.headersSent) res.json({ data: data ?? null })
  } catch (e) {
    const err = e as Error & { status?: number }
    if (!res.headersSent) res.status(err.status ?? 400).json({ error: err.message })
  }
}

const cwdOf = (req: Request): string => store.projectById(String(req.params.id)).path
const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Missing "${name}"`)
  return v
}
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

const api = express.Router()

// ------------------------------------------------------------------ app-level
api.get('/health', h(async () => ({ ok: true, version: '0.1.0', platform: process.platform })))
api.get('/logs', h(async () => recentLogs))
api.get('/settings', h(async () => store.settings()))
api.put('/settings', h(async (req) => {
  const { token, clearToken, pullMode } = req.body ?? {}
  if (clearToken) await store.setToken(null, null)
  else if (typeof token === 'string' && token.trim()) {
    const user = await gh.getUser(token.trim())
    await store.setToken(token.trim(), user)
  }
  if (pullMode) await store.setPullMode(pullMode)
  return store.settings()
}))

/** Folder browser for the "Browse…" button (the browser cannot read real paths itself). */
api.get('/fs/dirs', h(async (req) => {
  const requested = typeof req.query.path === 'string' && req.query.path ? req.query.path : os.homedir()
  const dir = path.resolve(requested)
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort((a, b) => a.localeCompare(b))
  const parent = path.dirname(dir)
  const roots = process.platform === 'win32'
    ? 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`).filter((r) => existsSync(r))
    : ['/']
  return { path: dir, parent: parent === dir ? null : parent, dirs, home: os.homedir(), roots, sep: path.sep }
}))

// ------------------------------------------------------------------ projects
api.get('/projects', h(async () => store.projects()))
api.post('/projects', h(async (req) => store.addProject(str(req.body.path, 'path'))))
api.delete('/projects/:id', h(async (req) => store.removeProject(String(req.params.id))))

api.post('/projects/clone', h(async (req) => {
  const { url, parentDir, folder } = req.body
  const dir = await git.clone(str(parentDir, 'parentDir'), str(url, 'url').trim(), str(folder, 'folder').trim())
  return store.addProject(dir)
}))

/** Copy someone else's repo into a new repo on my GitHub. Their repo stays as "upstream". */
api.post('/projects/import', h(async (req) => {
  const { url, parentDir, folder, private: isPrivate } = req.body
  const dir = await git.clone(str(parentDir, 'parentDir'), str(url, 'url').trim(), str(folder, 'folder').trim())
  await git.renameRemote(dir, 'origin', 'upstream')
  const repo = await gh.createRepo(store.token(), dir, folder.trim(), !!isPrivate, `Imported from ${url.trim()}`)
  await git.setRemote(dir, 'origin', repo.cloneUrl)
  await git.pushAllFirstTime(dir)
  return store.addProject(dir)
}))

const P = '/projects/:id'

api.post(`${P}/open-folder`, h(async (req) => {
  const dir = cwdOf(req)
  const cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  spawn(cmd, [dir], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref()
}))

// ------------------------------------------------------------------ status & changes
api.get(`${P}/status`, h(async (req) => git.status(cwdOf(req))))
api.post(`${P}/init`, h(async (req) => git.initRepo(cwdOf(req))))
api.post(`${P}/stage`, h(async (req) => git.stage(cwdOf(req), list(req.body.files))))
api.post(`${P}/unstage`, h(async (req) => git.unstage(cwdOf(req), list(req.body.files))))
api.post(`${P}/discard`, h(async (req) => git.discard(cwdOf(req), str(req.body.file, 'file'), !!req.body.untracked)))
api.get(`${P}/diff`, h(async (req) => git.diffFile(cwdOf(req), str(req.query.file, 'file'))))
api.post(`${P}/commit`, h(async (req) => git.commit(cwdOf(req), String(req.body.message ?? ''))))
api.post(`${P}/ai/commit-message`, h(async (req) => {
  const cwd = cwdOf(req)
  return ai.commitMessage(cwd, await git.stagedDiff(cwd))
}))

/** Folder → git repo → new GitHub repo → first push. Skips steps that are already done. */
api.post(`${P}/publish`, h(async (req) => {
  const cwd = cwdOf(req)
  const { name, private: isPrivate, description } = req.body
  if (!(await git.isRepo(cwd))) await git.initRepo(cwd)
  await git.ensureFirstCommit(cwd)
  const repo = await gh.createRepo(store.token(), cwd, str(name, 'name').trim(), !!isPrivate, String(description ?? ''))
  await git.setRemote(cwd, 'origin', repo.cloneUrl)
  await git.pushAllFirstTime(cwd)
  return repo.htmlUrl
}))
api.post(`${P}/remotes`, h(async (req) => git.addRemoteAndFetch(cwdOf(req), str(req.body.name, 'name').trim(), str(req.body.url, 'url').trim())))

// ------------------------------------------------------------------ sync
api.post(`${P}/push`, h(async (req) => git.push(cwdOf(req))))
api.post(`${P}/pull`, h(async (req) => git.pull(cwdOf(req), store.settings().pullMode)))
api.post(`${P}/fetch`, h(async (req) => git.fetchAll(cwdOf(req))))

// ------------------------------------------------------------------ branches
api.get(`${P}/branches`, h(async (req) => git.branches(cwdOf(req))))
api.post(`${P}/branches`, h(async (req) => git.createBranch(cwdOf(req), str(req.body.name, 'name'), req.body.base || null)))
api.post(`${P}/branches/switch`, h(async (req) => git.switchBranch(cwdOf(req), str(req.body.name, 'name'), !!req.body.stash)))
api.post(`${P}/branches/delete`, h(async (req) => git.deleteBranch(cwdOf(req), str(req.body.name, 'name'), !!req.body.force, !!req.body.remote)))

// ------------------------------------------------------------------ merge & conflicts
api.post(`${P}/merge`, h(async (req) => git.merge(cwdOf(req), str(req.body.source, 'source'))))
api.post(`${P}/merge/abort`, h(async (req) => git.mergeAbort(cwdOf(req))))
api.post(`${P}/merge/complete`, h(async (req) => git.mergeComplete(cwdOf(req))))
api.get(`${P}/conflicts`, h(async (req) => git.conflicts(cwdOf(req))))
api.post(`${P}/conflicts/resolve`, h(async (req) => {
  const side = req.body.side
  if (!['ours', 'theirs', 'both', 'content'].includes(side)) throw new Error('side must be ours, theirs, both or content')
  return git.resolveWith(cwdOf(req), str(req.body.file, 'file'), side, req.body.content)
}))

// ------------------------------------------------------------------ stash
api.get(`${P}/stash`, h(async (req) => git.stashList(cwdOf(req))))
api.post(`${P}/stash`, h(async (req) => git.stashPush(cwdOf(req))))
api.post(`${P}/stash/pop`, h(async (req) => git.stashPop(cwdOf(req))))

// ------------------------------------------------------------------ history
api.get(`${P}/log`, h(async (req) => git.log(cwdOf(req), typeof req.query.branch === 'string' && req.query.branch ? req.query.branch : null, Math.min(Number(req.query.limit) || 400, 5000))))
api.get(`${P}/commits/:hash`, h(async (req) => git.commitDetails(cwdOf(req), String(req.params.hash))))
api.get(`${P}/commits/:hash/diff`, h(async (req) => git.showCommitDiff(cwdOf(req), String(req.params.hash))))
api.post(`${P}/commits/:hash/cherry-pick`, h(async (req) => git.cherryPick(cwdOf(req), String(req.params.hash))))
api.post(`${P}/commits/:hash/revert`, h(async (req) => git.revert(cwdOf(req), String(req.params.hash), !!req.body.isMerge)))

// ------------------------------------------------------------------ versions (tags)
api.get(`${P}/versions`, h(async (req) => {
  const cwd = cwdOf(req)
  const [all, remote] = await Promise.all([git.versions(cwd), git.remoteTags(cwd)])
  const since = all[0] ? await git.commitsSince(cwd, all[0].name) : 0
  return { list: all.map((v) => ({ ...v, onRemote: remote.includes(v.name) })), sinceLatest: since }
}))
api.get(`${P}/versions/latest`, h(async (req) => {
  const cwd = cwdOf(req)
  const v = (await git.versions(cwd))[0]
  return v ? { ...v, since: await git.commitsSince(cwd, v.name) } : null
}))
api.post(`${P}/versions`, h(async (req) => {
  const cwd = cwdOf(req)
  const { name, title = '', notes = '', target = null, push, release } = req.body
  await git.createTag(cwd, str(name, 'name'), String(title), String(notes), target)
  if (push || release) await git.pushTag(cwd, name)
  if (release) {
    const repo = git.parseGithubRepo((await git.status(cwd)).remoteUrl)
    if (!repo) throw new Error('Version saved, but "origin" is not a GitHub repo, so no Release page was made.')
    return gh.createRelease(store.token(), cwd, repo.owner, repo.repo, name, String(title), String(notes))
  }
  return null
}))
api.get(`${P}/versions/:name/changes`, h(async (req) => {
  const cwd = cwdOf(req)
  const to = String(req.params.name)
  const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : null
  const r = await git.runGit(cwd, ['log', '--format=%h  %s  (%an, %ad)', '--date=short', ...(from ? [`${from}..${to}`] : [to])], { quiet: true })
  const stat = from ? (await git.runGit(cwd, ['diff', '--stat', from, to], { quiet: true })).stdout : ''
  return (r.stdout.trim() || '(no commits)') + (stat ? '\n\nFiles:\n' + stat : '')
}))
api.post(`${P}/versions/:name/push`, h(async (req) => git.pushTag(cwdOf(req), String(req.params.name))))
api.post(`${P}/versions/:name/start`, h(async (req) => git.startFromVersion(cwdOf(req), String(req.params.name), str(req.body.branch, 'branch'))))
api.post(`${P}/versions/:name/restore`, h(async (req) => git.restoreVersion(cwdOf(req), String(req.params.name))))
api.get(`${P}/versions/:name/zip`, async (req, res) => {
  try {
    const cwd = cwdOf(req)
    const tag = String(req.params.name)
    const file = path.join(os.tmpdir(), `git-studio-${Date.now()}.zip`)
    await git.archive(cwd, tag, file)
    res.download(file, `${path.basename(cwd)}-${tag.replace(/[^\w.-]/g, '_')}.zip`, () => { fs.unlink(file).catch(() => {}) })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})
api.post(`${P}/ai/release-notes`, h(async (req) => {
  const cwd = cwdOf(req)
  const since = typeof req.body.since === 'string' && req.body.since ? req.body.since : null
  const r = await git.runGit(cwd, ['log', '--format=- %s', ...(since ? [`${since}..HEAD`] : ['-n', '50'])], { quiet: true })
  return ai.releaseNotes(cwd, r.stdout)
}))

app.use('/api', api)
app.use('/api', (_req, res) => { res.status(404).json({ error: 'Unknown API route' }) })

// ------------------------------------------------------------------ frontend (production build)
const frontendDist = process.env.FRONTEND_DIST || path.resolve(__dirname, '../../frontend/dist')
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist))
  app.use((req: Request, res: Response, next: NextFunction) => (req.method === 'GET' ? res.sendFile(path.join(frontendDist, 'index.html')) : next()))
}

// ------------------------------------------------------------------ websocket
// client → server: {type:'pty:start', key, kind, projectId, cols, rows} | {type:'pty:write', key, data}
//                  {type:'pty:resize', key, cols, rows} | {type:'pty:kill', key}
// server → client: {type:'log', entry} | {type:'pty:data', key, data} | {type:'pty:exit', key}
const server = createServer(app)
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/ws') || !trusted(req)) { socket.destroy(); return }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
})

wss.on('connection', (ws) => {
  clients.add(ws)
  ws.on('close', () => clients.delete(ws))
  ws.on('message', (raw) => {
    let m: { type: string; key: string; kind?: PtyKind; projectId?: string; cols?: number; rows?: number; data?: string }
    try { m = JSON.parse(String(raw)) } catch { return }
    if (typeof m.key !== 'string') return
    if (m.type === 'pty:start') {
      let cwd = os.homedir()
      try { if (m.projectId) cwd = store.projectById(m.projectId).path } catch { /* unknown project */ }
      const kind: PtyKind = m.kind === 'claude' || m.kind === 'codex' ? m.kind : 'shell'
      const old = pty.start(m.key, kind, cwd, m.cols ?? 100, m.rows ?? 24, broadcast)
      if (old) ws.send(JSON.stringify({ type: 'pty:data', key: m.key, data: old }))
    } else if (m.type === 'pty:write' && typeof m.data === 'string') pty.write(m.key, m.data)
    else if (m.type === 'pty:resize') pty.resize(m.key, m.cols ?? 100, m.rows ?? 24)
    else if (m.type === 'pty:kill') pty.kill(m.key)
  })
})

// ------------------------------------------------------------------ start
store.load().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`Git Studio API on http://${HOST}:${PORT}  (config: ${store.configDir})`)
    if (existsSync(frontendDist)) console.log(`Open http://localhost:${PORT} in your browser`)
  })
})

const shutdown = (): void => { pty.killAll(); process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
