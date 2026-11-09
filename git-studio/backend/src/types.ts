// Types shared by the main process, the preload bridge and the React UI.

export interface Project {
  id: string
  name: string
  path: string
}

export interface LogEntry {
  id: number
  cwd: string
  cmd: string
  output: string
  status: 'running' | 'ok' | 'error'
  at: number
}

export interface FileChange {
  path: string
  /** Two-letter porcelain code, e.g. " M", "A ", "??", "UU" */
  code: string
  staged: boolean
  unstaged: boolean
  conflicted: boolean
  label: string
}

export interface StatusInfo {
  isRepo: boolean
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  files: FileChange[]
  merging: boolean
  hasCommits: boolean
  remoteUrl: string | null
}

export interface BranchInfo {
  name: string
  current: boolean
  remote: boolean
}

export interface CommitRow {
  hash: string
  short: string
  parents: string[]
  author: string
  date: string
  subject: string
  refs: string[]
  tags: string[]
}

export interface CommitDetails {
  hash: string
  subject: string
  body: string
  author: string
  date: string
  madeOn: string
  containedIn: string[]
  version: string | null
  files: { path: string; added: string; removed: string }[]
}

export interface VersionInfo {
  name: string
  title: string
  notes: string
  date: string
  commit: string
  onRemote: boolean
}

export interface ConflictFile {
  path: string
  content: string
  ours: string
  theirs: string
}

export interface Settings {
  githubToken: string | null
  githubUser: string | null
  pullMode: 'merge' | 'rebase'
}

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string }

export type PtyKind = 'claude' | 'codex' | 'shell'
