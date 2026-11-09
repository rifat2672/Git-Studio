// Starts the API on a temp config, builds a small repo with branches, a conflict
// and versions, and checks the main endpoints. Run: npm test
import { spawn, execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'

const PORT = 4399
const base = `http://127.0.0.1:${PORT}/api`
const tmp = mkdtempSync(path.join(os.tmpdir(), 'gs-test-'))
const repo = path.join(tmp, 'demo')
const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' }).toString()

async function req<T = any>(method: string, url: string, body?: unknown, expectOk = true): Promise<T> {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json()
  if (expectOk && !r.ok) throw new Error(`${method} ${url} -> ${r.status} ${j.error}`)
  return (expectOk ? j.data : j) as T
}
let passed = 0
function check(cond: unknown, msg: string): void {
  if (!cond) throw new Error('FAILED: ' + msg)
  passed++
  console.log('  ok', msg)
}

async function main(): Promise<void> {
  execFileSync('mkdir', ['-p', repo])
  g('init', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 'Tester')
  writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n')
  const server = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { env: { ...process.env, PORT: String(PORT), GIT_STUDIO_HOME: path.join(tmp, 'cfg') }, stdio: 'inherit' })
  try {
    for (let i = 0; i < 50; i++) { try { await req('GET', '/health'); break } catch { await new Promise((r) => setTimeout(r, 200)) } }
    const p = await req('POST', '/projects', { path: repo })
    const P = `/projects/${p.id}`
    let st = await req('GET', `${P}/status`)
    check(st.isRepo && !st.hasCommits && st.files.length === 1 && st.files[0].label === 'Untracked', 'status on new repo')
    await req('POST', `${P}/stage`, { files: ['a.txt'] })
    await req('POST', `${P}/commit`, { message: 'First commit' })
    st = await req('GET', `${P}/status`)
    check(st.hasCommits && st.files.length === 0 && st.branch === 'main', 'commit')
    await req('POST', `${P}/versions`, { name: 'v1.0.0', title: 'First', notes: '- start' })
    await req('POST', `${P}/branches`, { name: 'feature/x' })
    writeFileSync(path.join(repo, 'a.txt'), 'one\nTWO from feature\nthree\n')
    await req('POST', `${P}/stage`, { files: ['a.txt'] })
    await req('POST', `${P}/commit`, { message: 'Feature change' })
    await req('POST', `${P}/branches/switch`, { name: 'main' })
    writeFileSync(path.join(repo, 'a.txt'), 'one\nTWO from main\nthree\n')
    await req('POST', `${P}/stage`, { files: ['a.txt'] })
    await req('POST', `${P}/commit`, { message: 'Main change' })
    const br = await req('GET', `${P}/branches`)
    check(br.length === 2 && br.find((b: any) => b.current).name === 'main', 'branches list')
    const m = await req('POST', `${P}/merge`, { source: 'feature/x' })
    check(m.conflicts === true, 'merge reports conflict')
    st = await req('GET', `${P}/status`)
    check(st.merging && st.files[0].conflicted, 'status shows merging + conflicted file')
    const c = await req('GET', `${P}/conflicts`)
    check(c[0].ours.includes('from main') && c[0].theirs.includes('from feature'), 'conflict sides')
    const bad = await req('POST', `${P}/merge/complete`, {}, false)
    check(bad.error && bad.error.includes('still have conflicts'), 'complete blocked while conflicts remain')
    await req('POST', `${P}/conflicts/resolve`, { file: 'a.txt', side: 'both' })
    check(!require('fs').readFileSync(path.join(repo, 'a.txt'), 'utf8').includes('<<<<<<<'), 'keep both removes markers')
    await req('POST', `${P}/merge/complete`)
    st = await req('GET', `${P}/status`)
    check(!st.merging, 'merge completed')
    const log = await req('GET', `${P}/log`)
    check(log.length === 4 && log[0].parents.length === 2 && log.some((x: any) => x.tags.includes('v1.0.0')), 'log with merge + tag')
    const feat = log.find((x: any) => x.subject === 'Feature change')
    const d = await req('GET', `${P}/commits/${feat.hash}`)
    check(d.madeOn === 'feature/x' && d.containedIn.includes('main') && d.files[0].path === 'a.txt', `details madeOn=${d.madeOn}`)
    const v = await req('GET', `${P}/versions`)
    check(v.list[0].name === 'v1.0.0' && v.list[0].title === 'First' && v.sinceLatest === 3, 'versions + commits since')
    const ch = await req('GET', `${P}/versions/v1.0.0/changes`)
    check(ch.includes('First commit'), 'version changes')
    await req('POST', `${P}/versions/v1.0.0/start`, { branch: 'fix/from-v1' })
    st = await req('GET', `${P}/status`)
    check(st.branch === 'fix/from-v1', 'start work from version')
    await req('POST', `${P}/branches/switch`, { name: 'main' })
    writeFileSync(path.join(repo, 'new.txt'), 'added later\n')
    await req('POST', `${P}/stage`, { files: ['new.txt'] }); await req('POST', `${P}/commit`, { message: 'Add new file' })
    await req('POST', `${P}/versions/v1.0.0/restore`)
    check(require('fs').readFileSync(path.join(repo, 'a.txt'), 'utf8') === 'one\ntwo\nthree\n' && !require('fs').existsSync(path.join(repo, 'new.txt')), 'restore files from version')
    check(g('log', '-1', '--format=%s').trim() === 'Restore files from v1.0.0', 'restore is a new commit')
    await req('POST', `${P}/commits/${feat.hash}/revert`, {}, false)
    const zip = await fetch(`${base}${P}/versions/v1.0.0/zip`)
    check(zip.ok && (await zip.arrayBuffer()).byteLength > 50, 'zip download')
    const forbidden = await fetch(`${base}/projects`, { headers: { Origin: 'https://evil.example' } })
    check(forbidden.status === 403, 'other websites are blocked')
    const dirs = await req('GET', `/fs/dirs?path=${encodeURIComponent(tmp)}`)
    check(dirs.dirs.includes('demo'), 'folder browser')
    // websocket terminal
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`)
    const got = await new Promise<string>((resolve) => {
      let out = ''
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'pty:start', key: 't1', kind: 'shell', projectId: p.id, cols: 80, rows: 20 }))
        setTimeout(() => ws.send(JSON.stringify({ type: 'pty:write', key: 't1', data: 'echo GS_$((40+2))\r' })), 800)
      }
      ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.type === 'pty:data') { out += m.data; if (out.includes('GS_42')) resolve(out) } }
      setTimeout(() => resolve(out), 6000)
    })
    check(got.includes('GS_42'), 'terminal over websocket')
    ws.send(JSON.stringify({ type: 'pty:kill', key: 't1' })); ws.close()
    console.log(`\n${passed} checks passed`)
  } finally {
    server.kill()
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
