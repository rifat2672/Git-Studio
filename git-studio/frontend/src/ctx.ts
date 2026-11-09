import type { BranchInfo, Project, PtyKind, StatusInfo } from './types'
import type { DialogApi } from './components/Dialogs'

export type MainTab = 'changes' | 'history' | 'versions' | 'merge'

export interface Ctx {
  project: Project
  status: StatusInfo
  branches: BranchInfo[]
  refresh: () => Promise<void>
  /** Runs an action, shows errors as a toast and refreshes status afterwards. */
  run: <T>(fn: () => Promise<T>, okMsg?: string) => Promise<T | undefined>
  dialogs: DialogApi
  askAI: (kind: PtyKind, prompt: string) => void
  goTo: (tab: MainTab) => void
  switchBranch: (name: string) => Promise<void>
  newBranch: (base?: string | null) => Promise<void>
  publish: () => Promise<void>
  versionTarget: string | null
  setVersionTarget: (hash: string | null) => void
}

export function oneLine(s: string, max = 1500): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + ' …' : t
}
