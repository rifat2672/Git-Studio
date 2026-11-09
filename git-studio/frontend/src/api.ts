// Frontend client for the Git Studio backend.
//  - REST calls go to /api/... (see backend/src/server.ts for the full list)
//  - Live logs and terminals use one WebSocket on /ws
import type {
  BranchInfo, CommitDetails, CommitRow, ConflictFile, LogEntry, Project, PtyKind, Settings, StatusInfo, VersionInfo
} from './types'

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch('/api' + url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
  } catch {
    throw new Error('Cannot reach the Git Studio backend. Is it running? (npm run dev)')
  }
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `${method} ${url} failed (${res.status})`)
  return json.data as T
}
const get = <T>(u: string) => request<T>('GET', u)
const post = <T = void>(u: string, b: unknown = {}) => request<T>('POST', u, b)
const enc = encodeURIComponent
const P = (id: string) => `/projects/${enc(id)}`

// The folder picker is a dialog in the UI; App registers it here.
let folderPicker: (title: string) => Promise<string | null> = async () => null
export function setFolderPicker(fn: typeof folderPicker): void { folderPicker = fn }

/** Every backend call the UI makes. Project calls take the project id first. */
const client = {
  // app
  settings: () => get<Settings>('/settings'),
  setToken: async (token: string) =>
    (await request<Settings>('PUT', '/settings', token.trim() ? { token } : { clearToken: true })).githubUser,
  setPullMode: (pullMode: 'merge' | 'rebase') => request<Settings>('PUT', '/settings', { pullMode }),
  logs: () => get<LogEntry[]>('/logs'),
  listDirs: (path: string | null) => get<{ path: string; parent: string | null; dirs: string[]; home: string; roots: string[]; sep: string }>(
    '/fs/dirs' + (path ? `?path=${enc(path)}` : '')),
  pickFolder: (title: string) => folderPicker(title),
  openUrl: async (url: string) => { window.open(url, '_blank', 'noopener') },

  // projects
  listProjects: () => get<Project[]>('/projects'),
  addProject: (path: string) => post<Project>('/projects', { path }),
  removeProject: (id: string) => request<void>('DELETE', P(id)),
  cloneRepo: (url: string, parentDir: string, folder: string) => post<Project>('/projects/clone', { url, parentDir, folder }),
  importAsMine: (url: string, parentDir: string, folder: string, isPrivate: boolean) =>
    post<Project>('/projects/import', { url, parentDir, folder, private: isPrivate }),
  openFolder: (id: string) => post(`${P(id)}/open-folder`),
  publishToGithub: (id: string, name: string, isPrivate: boolean, description: string) =>
    post<string>(`${P(id)}/publish`, { name, private: isPrivate, description }),
  addRemote: (id: string, name: string, url: string) => post(`${P(id)}/remotes`, { name, url }),

  // status & changes
  status: (id: string) => get<StatusInfo>(`${P(id)}/status`),
  initRepo: (id: string) => post(`${P(id)}/init`),
  stage: (id: string, files: string[]) => post(`${P(id)}/stage`, { files }),
  unstage: (id: string, files: string[]) => post(`${P(id)}/unstage`, { files }),
  discard: (id: string, file: string, untracked: boolean) => post(`${P(id)}/discard`, { file, untracked }),
  diffFile: (id: string, file: string) => get<string>(`${P(id)}/diff?file=${enc(file)}`),
  commit: (id: string, message: string) => post(`${P(id)}/commit`, { message }),
  aiCommitMessage: (id: string) => post<string>(`${P(id)}/ai/commit-message`),

  // sync
  push: (id: string) => post(`${P(id)}/push`),
  pull: (id: string) => post(`${P(id)}/pull`),
  fetch: (id: string) => post(`${P(id)}/fetch`),

  // branches, merge, stash
  branches: (id: string) => get<BranchInfo[]>(`${P(id)}/branches`),
  createBranch: (id: string, name: string, base: string | null) => post(`${P(id)}/branches`, { name, base }),
  switchBranch: (id: string, name: string, stash: boolean) => post(`${P(id)}/branches/switch`, { name, stash }),
  deleteBranch: (id: string, name: string, force: boolean, remote: boolean) => post(`${P(id)}/branches/delete`, { name, force, remote }),
  merge: (id: string, source: string) => post<{ conflicts: boolean }>(`${P(id)}/merge`, { source }),
  mergeAbort: (id: string) => post(`${P(id)}/merge/abort`),
  mergeComplete: (id: string) => post(`${P(id)}/merge/complete`),
  conflicts: (id: string) => get<ConflictFile[]>(`${P(id)}/conflicts`),
  resolveWith: (id: string, file: string, side: 'ours' | 'theirs' | 'both' | 'content', content?: string) =>
    post(`${P(id)}/conflicts/resolve`, { file, side, content }),
  stashList: (id: string) => get<string[]>(`${P(id)}/stash`),
  stashPush: (id: string) => post(`${P(id)}/stash`),
  stashPop: (id: string) => post(`${P(id)}/stash/pop`),

  // history
  log: (id: string, branch: string | null, limit = 400) =>
    get<CommitRow[]>(`${P(id)}/log?limit=${limit}${branch ? `&branch=${enc(branch)}` : ''}`),
  commitDetails: (id: string, hash: string) => get<CommitDetails>(`${P(id)}/commits/${enc(hash)}`),
  showCommitDiff: (id: string, hash: string) => get<string>(`${P(id)}/commits/${enc(hash)}/diff`),
  cherryPick: (id: string, hash: string) => post(`${P(id)}/commits/${enc(hash)}/cherry-pick`),
  revert: (id: string, hash: string, isMerge: boolean) => post(`${P(id)}/commits/${enc(hash)}/revert`, { isMerge }),

  // versions
  versions: (id: string) => get<{ list: VersionInfo[]; sinceLatest: number }>(`${P(id)}/versions`),
  latestVersion: (id: string) => get<(VersionInfo & { since: number }) | null>(`${P(id)}/versions/latest`),
  createVersion: (id: string, o: { name: string; title: string; notes: string; target: string | null; push: boolean; release: boolean }) =>
    post<string | null>(`${P(id)}/versions`, o),
  versionChanges: (id: string, from: string | null, to: string) =>
    get<string>(`${P(id)}/versions/${enc(to)}/changes${from ? `?from=${enc(from)}` : ''}`),
  pushTag: (id: string, name: string) => post(`${P(id)}/versions/${enc(name)}/push`),
  startFromVersion: (id: string, name: string, branch: string) => post(`${P(id)}/versions/${enc(name)}/start`, { branch }),
  restoreVersion: (id: string, name: string) => post(`${P(id)}/versions/${enc(name)}/restore`),
  saveVersionZip: async (id: string, name: string) => {
    const a = document.createElement('a')
    a.href = `/api${P(id)}/versions/${enc(name)}/zip`
    a.download = ''
    a.click()
    return name
  },
  aiReleaseNotes: (id: string, since: string | null) => post<string>(`${P(id)}/ai/release-notes`, { since })
}

export type Client = typeof client

/** Typed call: call('status', projectId). Throws an Error with the backend's message on failure. */
export function call<K extends keyof Client>(method: K, ...args: Parameters<Client[K]>): ReturnType<Client[K]> {
  return (client[method] as (...a: unknown[]) => ReturnType<Client[K]>)(...args)
}

// ------------------------------------------------------------------ websocket
type ServerMsg = { type: 'log'; entry: LogEntry } | { type: 'pty:data'; key: string; data: string } | { type: 'pty:exit'; key: string }

const logListeners = new Set<(e: LogEntry) => void>()
const dataListeners = new Set<(key: string, data: string) => void>()
const exitListeners = new Set<(key: string) => void>()
let ws: WebSocket | null = null
let queue: string[] = []

function connect(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/ws`)
  ws.onopen = () => { for (const m of queue) ws!.send(m); queue = [] }
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data)) as ServerMsg
    if (m.type === 'log') logListeners.forEach((f) => f(m.entry))
    else if (m.type === 'pty:data') dataListeners.forEach((f) => f(m.key, m.data))
    else if (m.type === 'pty:exit') exitListeners.forEach((f) => f(m.key))
  }
  ws.onclose = () => { ws = null; setTimeout(connect, 1500) }
}
connect()

function send(msg: object): void {
  const text = JSON.stringify(msg)
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(text)
  else queue.push(text)
}

const listen = <T>(set: Set<T>, fn: T): (() => void) => { set.add(fn); return () => { set.delete(fn) } }

export const api = {
  onLog: (fn: (e: LogEntry) => void) => listen(logListeners, fn),
  pty: {
    start: (key: string, kind: PtyKind, projectId: string, cols: number, rows: number) =>
      send({ type: 'pty:start', key, kind, projectId, cols, rows }),
    write: (key: string, data: string) => send({ type: 'pty:write', key, data }),
    resize: (key: string, cols: number, rows: number) => send({ type: 'pty:resize', key, cols, rows }),
    kill: (key: string) => send({ type: 'pty:kill', key }),
    onData: (fn: (key: string, data: string) => void) => listen(dataListeners, fn),
    onExit: (fn: (key: string) => void) => listen(exitListeners, fn)
  }
}
