// Real terminals (node-pty). Claude and Codex tabs are shells that start the CLI.
// Output is kept in a small buffer so a reloaded page can show it again.
import * as pty from '@lydell/node-pty'
import os from 'os'
import type { PtyKind } from './types'

export type PtyEvent = { type: 'pty:data'; key: string; data: string } | { type: 'pty:exit'; key: string }

const MAX_BUFFER = 200_000
const terms = new Map<string, { p: pty.IPty; buffer: string }>()

function shell(): { file: string; args: string[] } {
  if (process.platform === 'win32') return { file: 'powershell.exe', args: ['-NoLogo'] }
  return { file: process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'), args: ['-l'] }
}

/** Starts a terminal, or returns the saved output if it is already running. */
export function start(key: string, kind: PtyKind, cwd: string, cols: number, rows: number, emit: (e: PtyEvent) => void): string | null {
  const existing = terms.get(key)
  if (existing) {
    existing.p.resize(Math.max(cols, 10), Math.max(rows, 4))
    return existing.buffer
  }
  const sh = shell()
  // The desktop app runs this backend with ELECTRON_RUN_AS_NODE. It must not reach
  // user shells, or Electron apps started from them (like VS Code) would break.
  const { ELECTRON_RUN_AS_NODE: _electronOnly, ...env } = process.env
  const p = pty.spawn(sh.file, sh.args, {
    name: 'xterm-256color', cols: Math.max(cols, 10), rows: Math.max(rows, 4), cwd: cwd || os.homedir(),
    env: { ...env, TERM: 'xterm-256color' } as Record<string, string>
  })
  const t = { p, buffer: '' }
  terms.set(key, t)
  p.onData((d) => {
    t.buffer = (t.buffer + d).slice(-MAX_BUFFER)
    emit({ type: 'pty:data', key, data: d })
  })
  p.onExit(() => {
    terms.delete(key)
    emit({ type: 'pty:exit', key })
  })
  if (kind === 'claude') p.write('claude\r')
  if (kind === 'codex') p.write('codex\r')
  return null
}

export function write(key: string, data: string): void { terms.get(key)?.p.write(data) }

export function resize(key: string, cols: number, rows: number): void {
  try { terms.get(key)?.p.resize(Math.max(cols, 10), Math.max(rows, 4)) } catch { /* closed */ }
}

export function kill(key: string): void {
  terms.get(key)?.p.kill()
  terms.delete(key)
}

export function killAll(): void {
  for (const t of terms.values()) t.p.kill()
  terms.clear()
}

export const running = (): string[] => [...terms.keys()]
