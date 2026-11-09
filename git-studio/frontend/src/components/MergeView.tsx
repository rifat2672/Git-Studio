import { useEffect, useState } from 'react'
import { call } from '../api'
import type { Ctx } from '../ctx'
import type { ConflictFile } from '../types'

export function MergeView({ ctx }: { ctx: Ctx }) {
  const { project, status, run, dialogs } = ctx
  const cwd = project.id
  const [source, setSource] = useState('')
  const [files, setFiles] = useState<ConflictFile[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [edit, setEdit] = useState('')
  const [dirty, setDirty] = useState(false)

  const others = ctx.branches.filter((b) => !b.current && b.name !== status.upstream)

  const loadConflicts = async (): Promise<void> => {
    const list = await call('conflicts', cwd)
    setFiles(list)
    const keep = list.find((f) => f.path === current) ?? list[0] ?? null
    setCurrent(keep?.path ?? null)
    if (!dirty || !keep) { setEdit(keep?.content ?? ''); setDirty(false) }
  }

  const conflictCount = status.files.filter((f) => f.conflicted).length
  useEffect(() => { if (status.merging) loadConflicts(); else setFiles([]) }, [status.merging, conflictCount, cwd])

  const file = files.find((f) => f.path === current) ?? null
  const pick = (f: ConflictFile): void => { setCurrent(f.path); setEdit(f.content); setDirty(false) }

  const resolve = async (side: 'ours' | 'theirs' | 'both' | 'content'): Promise<void> => {
    if (!file) return
    await run(() => call('resolveWith', cwd, file.path, side, side === 'content' ? edit : undefined), `${file.path} resolved`)
    setDirty(false)
    await loadConflicts()
  }

  const doMerge = async (): Promise<void> => {
    const src = source || others[0]?.name
    if (!src) return
    if (status.files.some((f) => f.label !== 'Untracked')) {
      return void dialogs.confirm('Commit first', 'You have uncommitted changes. Commit or stash them before merging.', 'OK')
    }
    if (!(await dialogs.confirm(`Merge ${src} into ${status.branch}?`, `All commits from ${src} will be added to ${status.branch}.`, 'Merge'))) return
    const r = await run(() => call('merge', cwd, src))
    if (r && !r.conflicts) await dialogs.confirm('Merged', `${src} was merged into ${status.branch}. Push when you are ready.`, 'OK')
  }

  const aiFix = (kind: 'claude' | 'codex'): void => {
    ctx.askAI(kind,
      `A git merge is in progress in this repo (into branch ${status.branch}). These files have conflicts: ${files.map((f) => f.path).join(', ')}. ` +
      'Resolve every conflict so that the intent of both sides is kept, remove all conflict markers, and run "git add" on each fixed file. ' +
      'Do NOT commit and do NOT delete anything without asking me. When done, tell me briefly what you chose in each file.')
  }

  if (!status.merging) {
    return (
      <div className="card col" style={{ maxWidth: 680, gap: 14 }}>
        <h2>Merge a branch into <span style={{ color: 'var(--accent)' }}>{status.branch}</span></h2>
        <p className="muted" style={{ margin: 0 }}>
          Brings all commits from another branch into the branch you are on. If both changed the same lines,
          you will resolve the conflicts here, by hand or with Claude / Codex.
        </p>
        {others.length === 0 ? (
          <div className="muted">There is no other branch to merge. Create one first.</div>
        ) : (
          <>
            <label className="field">Merge from
              <select className="select" value={source || others[0].name} onChange={(e) => setSource(e.target.value)}>
                {others.map((b) => <option key={b.name} value={b.name}>{b.name}{b.remote ? ' (remote)' : ''}</option>)}
              </select>
            </label>
            <div className="mono small muted">$ git merge --no-ff --no-edit {source || others[0].name}</div>
            <div className="row"><button className="btn primary" onClick={doMerge}>Merge into {status.branch}</button></div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="banner">
        <span style={{ fontWeight: 600 }}>Merge in progress → <span style={{ color: '#a9cbff' }}>{status.branch}</span></span>
        <span className="small" style={{ color: '#f0c9a8' }}>{files.length ? `${files.length} file(s) still have conflicts` : 'All conflicts resolved'}</span>
        <span className="grow" />
        <button className="btn danger" onClick={async () => {
          if (await dialogs.confirm('Abort the merge?', 'Everything goes back to how it was before you started the merge.', 'Abort merge', true)) {
            await run(() => call('mergeAbort', cwd), 'Merge aborted')
          }
        }}>Abort merge</button>
        <button className="btn primary" disabled={files.length > 0} onClick={() => run(() => call('mergeComplete', cwd), 'Merge completed')}>Complete merge</button>
      </div>

      {files.length === 0 ? (
        <div className="card muted">No conflicts left. Press “Complete merge” to finish, then Push.</div>
      ) : (
        <div className="split">
          <nav className="card col" style={{ flex: '1 1 220px', gap: 4 }} aria-label="Conflicted files">
            <div className="small muted" style={{ fontWeight: 600, letterSpacing: '0.05em' }}>FILES WITH CONFLICTS</div>
            {files.map((f) => (
              <button key={f.path} className={'proj' + (f.path === current ? ' active' : '')} onClick={() => pick(f)}>
                <span className="dot" style={{ background: 'var(--red)' }} />
                <span className="mono small ellipsis">{f.path}</span>
              </button>
            ))}
            <div style={{ height: 1, background: 'var(--border)', margin: '8px 0' }} />
            <button className="btn claude" onClick={() => aiFix('claude')}>Fix all with Claude</button>
            <button className="btn codex" onClick={() => aiFix('codex')}>Fix all with Codex</button>
            <span className="small muted">AI works in the terminal below. This list updates when it runs git add.</span>
          </nav>

          {file && (
            <section className="col" style={{ flex: '999 1 600px', minWidth: 0, gap: 12 }}>
              <div className="row wrap" style={{ alignItems: 'stretch' }}>
                <div className="side-pane pane-ours">
                  <div className="pane-title" style={{ color: '#a9cbff', borderBottom: '1px solid #22406e' }}>Current · {status.branch}</div>
                  <pre>{file.ours}</pre>
                </div>
                <div className="side-pane pane-theirs">
                  <div className="pane-title" style={{ color: '#ffc199', borderBottom: '1px solid #6a3a16' }}>Incoming</div>
                  <pre>{file.theirs}</pre>
                </div>
              </div>
              <div className="row wrap">
                <button className="btn" onClick={() => resolve('ours')}>Keep current</button>
                <button className="btn" onClick={() => resolve('theirs')}>Keep incoming</button>
                <button className="btn" onClick={() => resolve('both')}>Keep both</button>
              </div>
              <div className="card col" style={{ padding: 0, overflow: 'hidden', gap: 0 }}>
                <div className="row" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                  <span className="grow small" style={{ fontWeight: 600 }}>Edit by hand · remove the &lt;&lt;&lt;&lt;&lt;&lt;&lt; ======= &gt;&gt;&gt;&gt;&gt;&gt;&gt; lines</span>
                  <button className="btn sm" onClick={() => { setEdit(file.content); setDirty(false) }} disabled={!dirty}>Reset</button>
                  <button className="btn sm primary" disabled={/^(<{7}|={7}|>{7})( |$)/m.test(edit)} onClick={() => resolve('content')}>Save &amp; mark resolved</button>
                </div>
                <textarea className="textarea mono" spellCheck={false} value={edit} onChange={(e) => { setEdit(e.target.value); setDirty(true) }}
                  style={{ border: 0, borderRadius: 0, minHeight: 260, fontSize: 12, whiteSpace: 'pre', overflow: 'auto' }} />
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
