import { useEffect, useState } from 'react'
import { call } from '../api'
import type { Ctx } from '../ctx'
import type { VersionInfo } from '../types'

function parseVer(name: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(name)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function nextVersions(list: VersionInfo[]): string[] {
  const all = list.map((v) => parseVer(v.name)).filter((x): x is [number, number, number] => !!x)
  if (!all.length) return ['v0.1.0', 'v0.1.0', 'v1.0.0']
  const base = all.reduce((m, v) => (v[0] > m[0] || (v[0] === m[0] && (v[1] > m[1] || (v[1] === m[1] && v[2] > m[2]))) ? v : m))
  const [a, b, c] = base
  return [`v${a}.${b}.${c + 1}`, `v${a}.${b + 1}.0`, `v${a + 1}.0.0`]
}

const BUMPS = [
  { label: 'Small fix', hint: 'Patch: bug fixes only' },
  { label: 'New feature', hint: 'Minor: adds something, nothing breaks' },
  { label: 'Big change', hint: 'Major: old things may break' }
]

export function VersionsView({ ctx }: { ctx: Ctx }) {
  const { project, run, dialogs, status } = ctx
  const cwd = project.id
  const [list, setList] = useState<VersionInfo[]>([])
  const [since, setSince] = useState(0)
  const [loading, setLoading] = useState(true)
  const [bump, setBump] = useState(1)
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [push, setPush] = useState(true)
  const [release, setRelease] = useState(true)
  const [aiBusy, setAiBusy] = useState(false)
  const target = ctx.versionTarget

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const r = await call('versions', cwd)
      setList(r.list)
      setSince(r.sinceLatest)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [cwd])

  const suggestions = nextVersions(list)
  const finalName = nameTouched ? name : suggestions[bump]
  const hasRemote = !!status.remoteUrl
  const isGithub = /github\.com/.test(status.remoteUrl ?? '')

  const preview = [
    `$ git tag -a ${finalName} -m "${title || finalName}"${target ? ' ' + target.slice(0, 7) : ''}`,
    ...(hasRemote && (push || release) ? [`$ git push origin refs/tags/${finalName}`] : []),
    ...(isGithub && release ? [`→ GitHub API: create release ${finalName}`] : [])
  ].join('\n')

  const save = async (): Promise<void> => {
    if (list.some((v) => v.name === finalName)) return void dialogs.confirm('Name taken', `${finalName} already exists. Pick another name.`, 'OK')
    const url = await run(() => call('createVersion', cwd, {
      name: finalName, title, notes, target, push: hasRemote && (push || release), release: isGithub && release
    }), `Saved ${finalName}`)
    if (url !== undefined) {
      setTitle(''); setNotes(''); setNameTouched(false); ctx.setVersionTarget(null)
      await load()
    }
  }

  const aiNotes = async (): Promise<void> => {
    setAiBusy(true)
    const text = await run(() => call('aiReleaseNotes', cwd, list[0]?.name ?? null))
    setAiBusy(false)
    if (text) setNotes(text)
  }

  const prevOf = (i: number): string | null => list[i + 1]?.name ?? null

  const startFrom = async (v: VersionInfo): Promise<void> => {
    const r = await dialogs.ask({
      title: `Start work from ${v.name}`,
      text: 'Creates a new branch that starts exactly at this version and switches to it. Then commit, push and merge on it like normal. Nothing else changes.',
      fields: [{ key: 'b', label: 'New branch name', value: `fix/from-${v.name}`, required: true }],
      submit: 'Create branch'
    })
    if (r) await run(() => call('startFromVersion', cwd, v.name, String(r.b).trim().replace(/\s+/g, '-')), `Now on ${r.b}`)
  }

  const restore = async (v: VersionInfo): Promise<void> => {
    const ok = await dialogs.confirm(`Restore files from ${v.name}?`,
      <>All files on <strong>{status.branch}</strong> become exactly like {v.name}, saved as ONE new commit. History is kept, so you can undo it from the History tab. Your .env files are not touched. Commit or stash your current changes first.</>,
      'Restore', true)
    if (ok) await run(() => call('restoreVersion', cwd, v.name), `Restored files from ${v.name}`)
  }

  return (
    <div className="split">
      <section className="left col" style={{ gap: 12 }} aria-label="All versions">
        <div className="row">
          <h2 className="grow" style={{ margin: 0, fontSize: 18 }}>Versions</h2>
          <span className="small muted">Saved as git tags{isGithub ? ' · GitHub Releases' : ''}</span>
          <button className="btn ghost sm" onClick={load}>Refresh</button>
        </div>
        {loading && !list.length && <div className="empty">Loading…</div>}
        {!loading && !list.length && (
          <div className="card muted">No versions yet. Use the form to save the current state of the project as v0.1.0 or v1.0.0.</div>
        )}
        {list.map((v, i) => (
          <article key={v.name} className="card col" style={{ gap: 10, borderColor: i === 0 ? '#3a2f55' : undefined }}>
            <div className="row wrap">
              <span className="chip tag" style={{ fontSize: 14, padding: '3px 12px' }}>{v.name}</span>
              <strong>{v.title && v.title !== v.name ? v.title : ''}</strong>
              {i === 0 && <span className="chip green">LATEST</span>}
              <span className="grow" />
              <span className="small muted">{v.date}</span>
            </div>
            <div className="row wrap small" style={{ gap: 16, color: '#c2c9d3' }}>
              <span>Commit <span className="mono muted">{v.commit}</span></span>
              {i === 0 && <span>{since} commit{since === 1 ? '' : 's'} after it</span>}
              <span style={{ color: v.onRemote ? '#8ee5a1' : 'var(--muted)' }}>{v.onRemote ? 'On GitHub' : 'Only on this computer'}</span>
            </div>
            {v.notes && <div className="small muted" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{v.notes}</div>}
            <div className="row wrap">
              <button className="btn sm" onClick={async () => dialogs.show(`${prevOf(i) ?? 'start'} → ${v.name}`, await call('versionChanges', cwd, prevOf(i), v.name))}>What changed</button>
              <button className="btn sm" onClick={() => run(async () => { const f = await call('saveVersionZip', cwd, v.name); return f }, 'Download started')}>Download .zip</button>
              <button className="btn sm outline" onClick={() => startFrom(v)}>Start work from here</button>
              <button className="btn sm" onClick={() => restore(v)}>Restore files…</button>
              {!v.onRemote && hasRemote && <button className="btn sm" onClick={() => run(() => call('pushTag', cwd, v.name), 'Uploaded').then(load)}>Upload to GitHub</button>}
            </div>
          </article>
        ))}
      </section>

      <aside className="right card" aria-label="New version" style={{ borderColor: '#3a2f55', gap: 12 }}>
        <h2 style={{ fontSize: 17 }}>Save a new version</h2>
        <div className="small muted">
          {target
            ? <>From commit <span className="mono" style={{ color: 'var(--text)' }}>{target.slice(0, 7)}</span> (picked in History) · <button className="btn ghost sm" style={{ minHeight: 0, padding: 0 }} onClick={() => ctx.setVersionTarget(null)}>use latest instead</button></>
            : <>From the latest commit on <strong style={{ color: 'var(--text)' }}>{status.branch}</strong>{list[0] ? ` · ${since} commits since ${list[0].name}` : ''}</>}
        </div>
        {status.files.length > 0 && !target && (
          <div className="small" style={{ color: 'var(--yellow)' }}>You have {status.files.length} uncommitted change(s). They will NOT be in this version. Commit them first.</div>
        )}
        <fieldset style={{ border: 0, margin: 0, padding: 0 }} className="col">
          <legend className="small muted" style={{ marginBottom: 8 }}>What kind of change?</legend>
          {BUMPS.map((b, i) => (
            <label key={b.label} className="file" style={{ border: `1px solid ${bump === i && !nameTouched ? 'var(--purple)' : 'var(--border)'}`, borderRadius: 8, background: bump === i && !nameTouched ? '#221c33' : 'transparent' }}>
              <input type="radio" name="bump" checked={bump === i && !nameTouched} onChange={() => { setBump(i); setNameTouched(false) }} style={{ accentColor: 'var(--purple)' }} />
              <span className="col grow" style={{ gap: 0 }}><strong style={{ fontSize: 13 }}>{b.label}</strong><span className="small muted">{b.hint}</span></span>
              <span className="mono" style={{ color: '#c9b6ff' }}>{suggestions[i]}</span>
            </label>
          ))}
        </fieldset>
        <label className="field">Version name
          <input className="input mono" value={finalName} onChange={(e) => { setName(e.target.value.trim()); setNameTouched(true) }} />
        </label>
        <label className="field">Title
          <input className="input" value={title} placeholder="e.g. Payment gateway" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span className="row"><span className="grow">Release notes</span>
            <button type="button" className="btn sm" onClick={aiNotes} disabled={aiBusy}>{aiBusy && <span className="spinner" />}Write with AI</button>
          </span>
          <textarea className="textarea" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="- What is new&#10;- What was fixed" />
        </label>
        <label className="check"><input type="checkbox" checked={push && hasRemote} disabled={!hasRemote} onChange={(e) => setPush(e.target.checked)} />Upload version to GitHub{!hasRemote && ' (no remote)'}</label>
        <label className="check"><input type="checkbox" checked={release && isGithub} disabled={!isGithub} onChange={(e) => setRelease(e.target.checked)} />Create GitHub Release page</label>
        <pre className="diff" style={{ maxHeight: 120, whiteSpace: 'pre-wrap' }}>{preview}</pre>
        <button className="btn violet-solid" style={{ minHeight: 44 }} disabled={!finalName || !status.hasCommits} onClick={save}>Save version {finalName}</button>
        <div className="small muted">After saving, keep working as normal. New commits go after {finalName}; the version itself never changes.</div>
      </aside>
    </div>
  )
}
