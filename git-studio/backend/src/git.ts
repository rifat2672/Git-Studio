// All git work goes through runGit(), which also reports every command to the
// Activity tab. This file has no Electron imports so it can be tested with plain Node.
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import type {
  BranchInfo, CommitDetails, CommitRow, ConflictFile, FileChange, LogEntry, StatusInfo, VersionInfo
} from './types'

type LogSink = (e: LogEntry) => void
let sink: LogSink = () => {}
let tokenGetter: () => string | null = () => null
let nextId = 1

export function setLogSink(fn: LogSink): void { sink = fn }
export function setTokenGetter(fn: () => string | null): void { tokenGetter = fn }

export class GitError extends Error {}

interface RunOpts {
  /** Do not show in the Activity tab (used for background refreshes). */
  quiet?: boolean
  /** Return the result instead of throwing when the exit code is not 0. */
  allowFail?: boolean
  /** Needs GitHub auth (push, pull, fetch, clone, ls-remote). */
  network?: boolean
  input?: string
}

export interface RunResult { code: number; stdout: string; stderr: string }

const MAX_LOG = 6000

/** Start an Activity entry by hand (for non-git steps such as GitHub API calls). */
export function logStart(cwd: string, cmd: string): (ok: boolean, output: string) => void {
  const entry: LogEntry = { id: nextId++, cwd, cmd, output: '', status: 'running', at: Date.now() }
  sink({ ...entry })
  return (ok, output) => sink({ ...entry, status: ok ? 'ok' : 'error', output: output.slice(-MAX_LOG) })
}

function quoteForDisplay(a: string): string {
  return /[\s"'$`]/.test(a) ? JSON.stringify(a) : a
}

export function runProgram(
  program: string, args: string[], cwd: string, opts: RunOpts & { display?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; shell?: boolean } = {}
): Promise<RunResult> {
  const display = opts.display ?? [program, ...args].map(quoteForDisplay).join(' ')
  const done = opts.quiet ? null : logStart(cwd, display)
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let child
    try {
      child = spawn(program, args, {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...opts.env },
        shell: opts.shell ?? false,
        windowsHide: true
      })
    } catch (e) {
      const msg = `Could not start "${program}": ${(e as Error).message}`
      done?.(false, msg)
      return reject(new GitError(msg))
    }
    const timer = opts.timeoutMs ? setTimeout(() => child.kill(), opts.timeoutMs) : null
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', (e) => {
      if (timer) clearTimeout(timer)
      const msg = (e as NodeJS.ErrnoException).code === 'ENOENT'
        ? `"${program}" was not found. Install it and make sure it is on your PATH.`
        : e.message
      done?.(false, msg)
      reject(new GitError(msg))
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      const res = { code: code ?? 1, stdout, stderr }
      const out = (stdout + (stderr ? (stdout ? '\n' : '') + stderr : '')).trimEnd()
      done?.(res.code === 0, out)
      if (res.code !== 0 && !opts.allowFail) {
        reject(new GitError((stderr || stdout).trim() || `${display} failed (exit ${res.code})`))
      } else resolve(res)
    })
    if (opts.input !== undefined) child.stdin.end(opts.input)
    else child.stdin.end()
  })
}

export function runGit(cwd: string, args: string[], opts: RunOpts = {}): Promise<RunResult> {
  const prefix: string[] = ['-c', 'core.quotepath=off']
  const token = opts.network ? tokenGetter() : null
  if (token) {
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
    prefix.push('-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`)
  }
  // The token never appears in the Activity tab: we display the command without the -c options.
  const display = ['git', ...args].map(quoteForDisplay).join(' ')
  return runProgram('git', [...prefix, ...args], cwd, { ...opts, display })
}

async function out(cwd: string, args: string[], opts: RunOpts = { quiet: true }): Promise<string> {
  return (await runGit(cwd, args, opts)).stdout
}

async function ok(cwd: string, args: string[]): Promise<boolean> {
  return (await runGit(cwd, args, { quiet: true, allowFail: true })).code === 0
}

// ---------------------------------------------------------------- status

const LABELS: Record<string, string> = {
  '?': 'Untracked', A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', C: 'Copied', T: 'Type changed'
}
const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

export function parseStatus(raw: string): { branchLine: string; files: FileChange[] } {
  const parts = raw.split('\0')
  let branchLine = ''
  const files: FileChange[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (!p) continue
    if (p.startsWith('## ')) { branchLine = p.slice(3); continue }
    const code = p.slice(0, 2)
    const file = p.slice(3)
    if (code[0] === 'R' || code[0] === 'C') i++ // next part is the old name
    const conflicted = CONFLICT_CODES.has(code)
    const untracked = code === '??'
    const main = conflicted ? 'U' : (code[1] !== ' ' && !untracked ? code[1] : code[0])
    files.push({
      path: file,
      code,
      conflicted,
      staged: !untracked && !conflicted && code[0] !== ' ',
      unstaged: untracked || conflicted || code[1] !== ' ',
      label: conflicted ? 'Conflict' : LABELS[main] ?? code.trim()
    })
  }
  return { branchLine, files }
}

export function parseBranchLine(line: string): { branch: string; upstream: string | null; ahead: number; behind: number } {
  // "main...origin/main [ahead 1, behind 2]" | "No commits yet on main" | "HEAD (no branch)"
  if (line.startsWith('No commits yet on ')) return { branch: line.slice(18), upstream: null, ahead: 0, behind: 0 }
  if (line.startsWith('Initial commit on ')) return { branch: line.slice(18), upstream: null, ahead: 0, behind: 0 }
  const m = /^(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(line)
  if (!m) return { branch: line, upstream: null, ahead: 0, behind: 0 }
  const info = m[3] ?? ''
  const ahead = Number(/ahead (\d+)/.exec(info)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(info)?.[1] ?? 0)
  const branch = m[1] === 'HEAD (no branch)' ? 'HEAD (detached)' : m[1]
  return { branch, upstream: m[2] ?? null, ahead, behind }
}

export async function status(cwd: string): Promise<StatusInfo> {
  const isRepo = await ok(cwd, ['rev-parse', '--is-inside-work-tree'])
  if (!isRepo) {
    return { isRepo: false, branch: '', upstream: null, ahead: 0, behind: 0, files: [], merging: false, hasCommits: false, remoteUrl: null }
  }
  const [raw, hasCommits, merging, remote] = await Promise.all([
    out(cwd, ['status', '--porcelain=v1', '-b', '-z', '-uall']),
    ok(cwd, ['rev-parse', '--verify', '-q', 'HEAD']),
    ok(cwd, ['rev-parse', '--verify', '-q', 'MERGE_HEAD']),
    runGit(cwd, ['remote', 'get-url', 'origin'], { quiet: true, allowFail: true })
  ])
  const { branchLine, files } = parseStatus(raw)
  return {
    isRepo, ...parseBranchLine(branchLine), files, merging, hasCommits,
    remoteUrl: remote.code === 0 ? remote.stdout.trim() : null
  }
}

// ---------------------------------------------------------------- changes

export async function stage(cwd: string, files: string[]): Promise<void> {
  if (files.length) await runGit(cwd, ['add', '-A', '--', ...files])
}

export async function unstage(cwd: string, files: string[]): Promise<void> {
  if (!files.length) return
  if (await ok(cwd, ['rev-parse', '--verify', '-q', 'HEAD'])) await runGit(cwd, ['restore', '--staged', '--', ...files])
  else await runGit(cwd, ['rm', '--cached', '-r', '-q', '--', ...files])
}

export async function discard(cwd: string, file: string, untracked: boolean): Promise<void> {
  if (untracked) await runGit(cwd, ['clean', '-f', '--', file])
  else await runGit(cwd, ['restore', '--staged', '--worktree', '--source=HEAD', '--', file])
}

export async function diffFile(cwd: string, file: string): Promise<string> {
  const staged = await out(cwd, ['diff', '--cached', '--', file])
  const unstaged = await out(cwd, ['diff', '--', file])
  return (staged + unstaged).trim() || '(new file or binary - no text diff)'
}

export async function commit(cwd: string, message: string): Promise<void> {
  if (!message.trim()) throw new GitError('Write a commit message first.')
  await runGit(cwd, ['commit', '-m', message])
}

export async function stagedDiff(cwd: string): Promise<string> {
  return out(cwd, ['diff', '--cached', '--stat', '--patch', '--no-color'])
}

// ---------------------------------------------------------------- sync

export async function push(cwd: string): Promise<void> {
  const st = await status(cwd)
  if (!st.upstream) await runGit(cwd, ['push', '-u', 'origin', 'HEAD'], { network: true })
  else await runGit(cwd, ['push'], { network: true })
}

export async function pull(cwd: string, mode: 'merge' | 'rebase'): Promise<void> {
  await runGit(cwd, ['pull', mode === 'rebase' ? '--rebase' : '--no-rebase'], { network: true })
}

export async function fetchAll(cwd: string): Promise<void> {
  await runGit(cwd, ['fetch', '--all', '--prune', '--tags'], { network: true })
}

// ---------------------------------------------------------------- branches

export async function branches(cwd: string): Promise<BranchInfo[]> {
  const raw = await out(cwd, ['branch', '-a', '--format=%(HEAD)%09%(refname)'])
  const list: BranchInfo[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const [head, ref] = line.split('\t')
    if (ref.endsWith('/HEAD')) continue
    const remote = ref.startsWith('refs/remotes/')
    const name = ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, '')
    list.push({ name, current: head === '*', remote })
  }
  return list
}

export async function switchBranch(cwd: string, name: string, stashFirst: boolean): Promise<void> {
  if (stashFirst) await runGit(cwd, ['stash', 'push', '-u', '-m', `auto-stash before switching to ${name}`])
  // A remote branch like origin/feature becomes a local tracking branch "feature".
  const remoteMatch = /^([^/]+)\/(.+)$/.exec(name)
  const remotes = (await out(cwd, ['remote'])).split('\n').map((s) => s.trim()).filter(Boolean)
  if (remoteMatch && remotes.includes(remoteMatch[1])) {
    const local = remoteMatch[2]
    if (await ok(cwd, ['rev-parse', '--verify', '-q', `refs/heads/${local}`])) await runGit(cwd, ['switch', local])
    else await runGit(cwd, ['switch', '-c', local, '--track', name])
  } else {
    await runGit(cwd, ['switch', name])
  }
}

export async function createBranch(cwd: string, name: string, base: string | null): Promise<void> {
  await runGit(cwd, base ? ['switch', '-c', name, base] : ['switch', '-c', name])
}

export async function deleteBranch(cwd: string, name: string, force: boolean, alsoRemote: boolean): Promise<void> {
  await runGit(cwd, ['branch', force ? '-D' : '-d', name])
  if (alsoRemote) await runGit(cwd, ['push', 'origin', '--delete', name], { network: true })
}

export async function merge(cwd: string, source: string): Promise<{ conflicts: boolean }> {
  const r = await runGit(cwd, ['merge', '--no-ff', '--no-edit', source], { allowFail: true })
  if (r.code === 0) return { conflicts: false }
  if (await ok(cwd, ['rev-parse', '--verify', '-q', 'MERGE_HEAD'])) return { conflicts: true }
  throw new GitError((r.stderr || r.stdout).trim())
}

export async function mergeAbort(cwd: string): Promise<void> { await runGit(cwd, ['merge', '--abort']) }

export async function mergeComplete(cwd: string): Promise<void> {
  const left = await out(cwd, ['diff', '--name-only', '--diff-filter=U'])
  if (left.trim()) throw new GitError('Some files still have conflicts:\n' + left.trim())
  await runGit(cwd, ['commit', '--no-edit'])
}

export async function stashPush(cwd: string): Promise<void> { await runGit(cwd, ['stash', 'push', '-u']) }
export async function stashPop(cwd: string): Promise<void> { await runGit(cwd, ['stash', 'pop']) }
export async function stashList(cwd: string): Promise<string[]> {
  return (await out(cwd, ['stash', 'list'])).split('\n').filter(Boolean)
}

// ---------------------------------------------------------------- history

export function parseLog(raw: string): CommitRow[] {
  return raw.split('\x1e').map((r) => r.replace(/^\n/, '')).filter(Boolean).map((r) => {
    const [hash, parents, author, date, subject, deco] = r.split('\x1f')
    const refs: string[] = []
    const tags: string[] = []
    for (const d of (deco ?? '').split(', ').map((s) => s.trim()).filter(Boolean)) {
      if (d.startsWith('tag: ')) tags.push(d.slice(5))
      else if (d.startsWith('HEAD -> ')) refs.push(d.slice(8))
      else if (d !== 'HEAD' && !d.endsWith('/HEAD')) refs.push(d)
    }
    return { hash, short: hash.slice(0, 7), parents: parents ? parents.split(' ') : [], author, date, subject, refs, tags }
  })
}

export async function log(cwd: string, branch: string | null, limit = 400): Promise<CommitRow[]> {
  const fmt = '--format=%H%x1f%P%x1f%an%x1f%ad%x1f%s%x1f%D%x1e'
  const args = ['log', '--topo-order', `-n${limit}`, fmt, '--date=format:%Y-%m-%d %H:%M']
  args.push(...(branch ? [branch] : ['--all']))
  const r = await runGit(cwd, args, { quiet: true, allowFail: true })
  return r.code === 0 ? parseLog(r.stdout) : []
}

export async function commitDetails(cwd: string, hash: string): Promise<CommitDetails> {
  const [head, stat, nameRev, contains, tags] = await Promise.all([
    out(cwd, ['show', '-s', '--format=%H%x1f%s%x1f%b%x1f%an <%ae>%x1f%ad', '--date=format:%d %b %Y, %H:%M', hash]),
    out(cwd, ['show', '--numstat', '--format=', '--diff-merges=first-parent', hash]),
    runGit(cwd, ['name-rev', '--name-only', '--refs=refs/heads/*', '--refs=refs/remotes/*', hash], { quiet: true, allowFail: true }),
    out(cwd, ['branch', '-a', '--contains', hash, '--format=%(refname:short)']),
    out(cwd, ['tag', '--contains', hash, '--sort=creatordate'])
  ])
  const [h, subject, body, author, date] = head.split('\x1f')
  const rawName = nameRev.stdout.trim()
  const madeOn = !rawName || rawName === 'undefined' ? 'unknown (branch was deleted)' : rawName.replace(/[~^].*$/, '').replace(/^remotes\//, '')
  const files = stat.split('\n').filter(Boolean).map((l) => {
    const [added, removed, ...p] = l.split('\t')
    return { path: p.join('\t'), added, removed }
  })
  return {
    hash: h.trim(), subject, body: (body ?? '').trim(), author, date: (date ?? '').trim(), madeOn,
    containedIn: contains.split('\n').map((s) => s.trim()).filter((s) => s && !s.endsWith('/HEAD')),
    version: tags.split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? null,
    files
  }
}

export async function showCommitDiff(cwd: string, hash: string): Promise<string> {
  return out(cwd, ['show', '--no-color', '--diff-merges=first-parent', hash])
}

export async function cherryPick(cwd: string, hash: string): Promise<void> { await runGit(cwd, ['cherry-pick', hash]) }

export async function revert(cwd: string, hash: string, isMerge: boolean): Promise<void> {
  await runGit(cwd, isMerge ? ['revert', '--no-edit', '-m', '1', hash] : ['revert', '--no-edit', hash])
}

// ---------------------------------------------------------------- versions (tags)

export async function versions(cwd: string): Promise<VersionInfo[]> {
  const fmt = '--format=%(refname:short)%1f%(creatordate:format:%d %b %Y)%1f%(*objectname:short)%1f%(objectname:short)%1f%(contents:subject)%1f%(contents:body)%1e'
  const raw = await out(cwd, ['for-each-ref', 'refs/tags', '--sort=-v:refname', '--sort=-creatordate', fmt])
  return raw.split('\x1e').map((r) => r.replace(/^\n/, '')).filter(Boolean).map((r) => {
    const [name, date, peeled, obj, subject, body] = r.split('\x1f')
    return { name, date, commit: peeled || obj, title: subject ?? '', notes: (body ?? '').trim(), onRemote: false }
  })
}

export async function remoteTags(cwd: string): Promise<string[]> {
  const r = await runGit(cwd, ['ls-remote', '--tags', 'origin'], { quiet: true, allowFail: true, network: true })
  if (r.code !== 0) return []
  return r.stdout.split('\n').map((l) => l.split('\t')[1]).filter(Boolean)
    .map((ref) => ref.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, ''))
}

export async function commitsSince(cwd: string, tag: string): Promise<number> {
  const r = await runGit(cwd, ['rev-list', '--count', `${tag}..HEAD`], { quiet: true, allowFail: true })
  return r.code === 0 ? Number(r.stdout.trim()) : 0
}

export async function createTag(cwd: string, name: string, title: string, notes: string, target: string | null): Promise<void> {
  const args = ['tag', '-a', name, '-m', title || name]
  if (notes.trim()) args.push('-m', notes)
  if (target) args.push(target)
  await runGit(cwd, args)
}

export async function pushTag(cwd: string, name: string): Promise<void> {
  await runGit(cwd, ['push', 'origin', `refs/tags/${name}`], { network: true })
}

export async function startFromVersion(cwd: string, tag: string, branch: string): Promise<void> {
  await runGit(cwd, ['switch', '-c', branch, tag])
}

/** Bring back every file exactly as it was in the version, as one new commit. History is kept. */
export async function restoreVersion(cwd: string, tag: string): Promise<void> {
  const st = await status(cwd)
  if (st.files.length) throw new GitError('You have uncommitted changes. Commit or stash them before restoring a version.')
  await runGit(cwd, ['rm', '-r', '-q', '--cached', '--ignore-unmatch', '.'])
  await runGit(cwd, ['restore', `--source=${tag}`, '--staged', '--worktree', '--', '.'])
  // Files that did not exist in the version are now untracked; remove them from disk too.
  await runGit(cwd, ['clean', '-f', '-d', '-q', '-e', '.env*'])
  await runGit(cwd, ['add', '-A'])
  await runGit(cwd, ['commit', '-m', `Restore files from ${tag}`, '--allow-empty'])
}

export async function archive(cwd: string, tag: string, file: string): Promise<void> {
  await runGit(cwd, ['archive', '--format=zip', `--prefix=${path.basename(cwd)}-${tag}/`, '-o', file, tag])
}

// ---------------------------------------------------------------- conflicts

export async function conflicts(cwd: string): Promise<ConflictFile[]> {
  const names = (await out(cwd, ['diff', '--name-only', '--diff-filter=U'])).split('\n').map((s) => s.trim()).filter(Boolean)
  return Promise.all(names.map(async (p) => {
    const content = await fs.readFile(path.join(cwd, p), 'utf8').catch(() => '')
    const side = async (n: number) => {
      const r = await runGit(cwd, ['show', `:${n}:${p}`], { quiet: true, allowFail: true })
      return r.code === 0 ? r.stdout : '(file does not exist on this side)'
    }
    return { path: p, content, ours: await side(2), theirs: await side(3) }
  }))
}

/** Keep both sides of every conflict block: ours first, then theirs. */
export function keepBoth(content: string): string {
  const lines = content.split(/(?<=\n)/)
  const result: string[] = []
  let mode: 'normal' | 'ours' | 'base' | 'theirs' = 'normal'
  for (const line of lines) {
    if (line.startsWith('<<<<<<< ')) { mode = 'ours'; continue }
    if (mode === 'ours' && line.startsWith('||||||| ')) { mode = 'base'; continue }
    if ((mode === 'ours' || mode === 'base') && /^=======\r?\n?$/.test(line)) { mode = 'theirs'; continue }
    if (mode === 'theirs' && line.startsWith('>>>>>>> ')) { mode = 'normal'; continue }
    if (mode !== 'base') result.push(line)
  }
  return result.join('')
}

export async function resolveWith(cwd: string, file: string, side: 'ours' | 'theirs' | 'both' | 'content', content?: string): Promise<void> {
  const full = path.join(cwd, file)
  if (side === 'ours' || side === 'theirs') {
    const r = await runGit(cwd, ['checkout', `--${side}`, '--', file], { allowFail: true })
    if (r.code !== 0) {
      // The file was deleted on that side.
      await runGit(cwd, ['rm', '-q', '--', file])
      return
    }
  } else if (side === 'both') {
    await fs.writeFile(full, keepBoth(await fs.readFile(full, 'utf8')))
  } else {
    await fs.writeFile(full, content ?? '')
  }
  await runGit(cwd, ['add', '--', file])
}

// ---------------------------------------------------------------- repos

export async function isRepo(cwd: string): Promise<boolean> { return ok(cwd, ['rev-parse', '--is-inside-work-tree']) }

export async function clone(parentDir: string, url: string, folder: string): Promise<string> {
  await runGit(parentDir, ['clone', url, folder], { network: true })
  return path.join(parentDir, folder)
}

export async function initRepo(cwd: string): Promise<void> {
  await runGit(cwd, ['init', '-b', 'main'])
}

export async function ensureFirstCommit(cwd: string): Promise<void> {
  if (await ok(cwd, ['rev-parse', '--verify', '-q', 'HEAD'])) return
  await runGit(cwd, ['add', '-A'])
  await runGit(cwd, ['commit', '-m', 'Initial commit', '--allow-empty'])
}

export async function setRemote(cwd: string, name: string, url: string): Promise<void> {
  const exists = (await out(cwd, ['remote'])).split('\n').map((s) => s.trim()).includes(name)
  await runGit(cwd, exists ? ['remote', 'set-url', name, url] : ['remote', 'add', name, url])
}

export async function renameRemote(cwd: string, from: string, to: string): Promise<void> {
  await runGit(cwd, ['remote', 'rename', from, to])
}

export async function pushAllFirstTime(cwd: string): Promise<void> {
  await runGit(cwd, ['push', '-u', 'origin', 'HEAD'], { network: true })
  await runGit(cwd, ['push', 'origin', '--tags'], { network: true })
}

export async function addRemoteAndFetch(cwd: string, name: string, url: string): Promise<void> {
  await setRemote(cwd, name, url)
  await runGit(cwd, ['fetch', name, '--tags'], { network: true })
}

export function parseGithubRepo(url: string | null): { owner: string; repo: string } | null {
  if (!url) return null
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim())
  return m ? { owner: m[1], repo: m[2] } : null
}
