// One-shot AI helpers that run the Claude Code CLI in print mode (claude -p).
// The prompt goes in through stdin, so no shell quoting is needed on any OS.
import { runProgram } from './git'

async function ask(cwd: string, what: string, prompt: string): Promise<string> {
  const program = process.platform === 'win32' ? 'claude.cmd' : 'claude'
  const r = await runProgram(program, ['-p'], cwd, {
    input: prompt, display: `claude -p  (${what})`, timeoutMs: 120000,
    // .cmd files need a shell on Windows; the only argument is "-p", so this is safe.
    shell: process.platform === 'win32'
  })
  return r.stdout.trim()
}

export async function commitMessage(cwd: string, diff: string): Promise<string> {
  if (!diff.trim()) throw new Error('Stage some files first, then ask for a message.')
  const text = await ask(cwd, 'write commit message',
    'Write a short git commit message (one line, under 72 characters, imperative mood) for this staged diff. ' +
    'Reply with only the message, no quotes or explanation.\n\n' + diff.slice(0, 60000))
  return text.split('\n').find((l) => l.trim())?.replace(/^["'`]|["'`]$/g, '').trim() ?? ''
}

export async function releaseNotes(cwd: string, commits: string): Promise<string> {
  const text = await ask(cwd, 'write release notes',
    'Write short release notes as a markdown bullet list (max 8 bullets) for these git commits. ' +
    'Reply with only the list.\n\n' + commits.slice(0, 30000))
  return text
}
