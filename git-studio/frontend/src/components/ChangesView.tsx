import { useEffect, useState } from 'react'
import { call } from '../api'
import type { Ctx } from '../ctx'
import type { VersionInfo } from '../types'
import { DiffView } from './Dialogs'

const CODE_COLOR: Record<string, string> = {
  Modified: 'var(--yellow)', Added: 'var(--green)', Untracked: 'var(--green)', Deleted: 'var(--red)',
  Renamed: 'var(--accent)', Conflict: 'var(--red)'
}
const CODE_LETTER: Record<string, string> = { Untracked: 'U', Modified: 'M', Added: 'A', Deleted: 'D', Renamed: 'R', Conflict: '!' }

export function ChangesView({ ctx }: { ctx: Ctx }) {
  const { project, status, run, dialogs } = ctx
  const cwd = project.id
  const [msg, setMsg] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [latest, setLatest] = useState<(VersionInfo & { since: number }) | null>(null)
  const [stashes, setStashes] = useState<string[]>([])

  useEffect(() => {
    if (!status.isRepo) return
    call('latestVersion', cwd).then(setLatest).catch(() => setLatest(null))
    call('stashList', cwd).then(setStashes).catch(() => setStashes([]))
  }, [cwd, status.isRepo, status.hasCommits, status.ahead, status.files.length, status.branch])

  useEffect(() => {
    if (!selected) { setDiff(''); return }
    if (!status.files.some((f) => f.path === selected)) { setSelected(null); return }
    call('diffFile', cwd, selected).then(setDiff).catch((e) => setDiff(String(e.message)))
  }, [selected, cwd, status])

  if (!status.isRepo) {
    return (
      <div className="card col" style={{ maxWidth: 640, gap: 12 }}>
        <h2>This folder is not a git repository yet</h2>
        <p className="muted" style={{ margin: 0 }}>Start tracking it with git. You can also upload it to a new GitHub repo in one step.</p>
        <div className="row wrap">
          <button className="btn" onClick={() => run(() => call('initRepo', cwd), 'Git started')}>Start git here</button>
          <button className="btn primary" onClick={ctx.publish}>Start git + upload to GitHub</button>
        </div>
      </div>
    )
  }

  const files = status.files
  const staged = files.filter((f) => f.staged)
  const allStaged = files.length > 0 && files.every((f) => f.staged && !f.unstaged)

  const toggle = (path: string, isStaged: boolean): void => {
    run(() => (isStaged ? call('unstage', cwd, [path]) : call('stage', cwd, [path])))
  }

  const doCommit = async (andPush: boolean): Promise<void> => {
    let toCommit = staged.length
    if (!toCommit && files.length) {
      if (!(await dialogs.confirm('Nothing is staged', 'Stage all changed files and commit them?', 'Stage all & commit'))) return
      await run(() => call('stage', cwd, files.map((f) => f.path)))
      toCommit = files.length
    }
    const ok = await run(async () => { await call('commit', cwd, msg); return true }, andPush ? undefined : 'Committed')
    if (!ok) return
    setMsg('')
    if (andPush) {
      if (status.remoteUrl) await run(() => call('push', cwd), 'Committed and pushed')
      else ctx.publish()
    }
  }

  const aiMessage = async (): Promise<void> => {
    if (!staged.length) await run(() => call('stage', cwd, files.map((f) => f.path)))
    setAiBusy(true)
    const m = await run(() => call('aiCommitMessage', cwd))
    setAiBusy(false)
    if (m) setMsg(m)
  }

  const discard = async (): Promise<void> => {
    const f = files.find((x) => x.path === selected)
    if (!f) return
    const ok = await dialogs.confirm(`Throw away changes in ${f.path}?`,
      f.label === 'Untracked' ? 'This new file will be deleted from disk.' : 'The file goes back to how it was in the last commit. This cannot be undone.',
      'Discard', true)
    if (ok) await run(() => call('discard', cwd, f.path, f.label === 'Untracked'))
  }

  const pickBranch = async (title: string, list: string[], extra: Parameters<typeof dialogs.ask>[0]['fields'] = []) =>
    dialogs.ask({
      title,
      fields: [{ key: 'b', label: 'Branch', type: 'select', value: list[0], options: list.map((n) => ({ value: n, label: n })) }, ...(extra ?? [])],
      submit: 'OK'
    })

  const switchDialog = async (): Promise<void> => {
    const list = ctx.branches.filter((b) => !b.current).map((b) => b.name)
    if (!list.length) return void dialogs.confirm('No other branches', 'Create a new branch first.', 'OK')
    const v = await pickBranch('Switch to branch', list)
    if (v) await ctx.switchBranch(String(v.b))
  }

  const deleteDialog = async (): Promise<void> => {
    const list = ctx.branches.filter((b) => !b.current && !b.remote).map((b) => b.name)
    if (!list.length) return void dialogs.confirm('Nothing to delete', 'There are no other local branches.', 'OK')
    const v = await pickBranch('Delete a branch', list, [
      { key: 'remote', label: 'Also delete it on GitHub', type: 'checkbox' },
      { key: 'force', label: 'Delete even if it is not merged (its commits may be lost)', type: 'checkbox' }
    ])
    if (!v) return
    if (!(await dialogs.confirm(`Delete ${v.b}?`, v.force ? 'Unmerged commits on this branch will be lost.' : 'Git refuses if the branch has commits that are not merged anywhere.', 'Delete', true))) return
    await run(() => call('deleteBranch', cwd, String(v.b), !!v.force, !!v.remote), `Deleted ${v.b}`)
  }

  return (
    <div className="split">
      <div className="left col" style={{ gap: 16 }}>
        {status.merging && (
          <div className="banner">
            <span className="grow">A merge is in progress.</span>
            <button className="btn" onClick={() => ctx.goTo('merge')}>Open Merge tab</button>
          </div>
        )}
        <section className="card col" aria-label="Changed files" style={{ gap: 10 }}>
          <div className="row">
            <h2 className="grow">Changed files <span className="muted" style={{ fontWeight: 400 }}>· {staged.length} of {files.length} staged</span></h2>
            {files.length > 0 && (
              allStaged
                ? <button className="btn sm" onClick={() => run(() => call('unstage', cwd, files.map((f) => f.path)))}>Unstage all</button>
                : <button className="btn sm" onClick={() => run(() => call('stage', cwd, files.map((f) => f.path)))}>Stage all</button>
            )}
          </div>
          {files.length === 0 && <div className="muted" style={{ padding: '16px 0' }}>No changes. Everything is committed.</div>}
          <div style={{ maxHeight: 320, overflow: 'auto' }}>
            {files.map((f) => (
              <div key={f.path} className={'file' + (selected === f.path ? ' sel' : '')} onClick={() => setSelected(f.path)}>
                <input type="checkbox" aria-label={`Stage ${f.path}`} checked={f.staged && !f.unstaged}
                  ref={(el) => { if (el) el.indeterminate = f.staged && f.unstaged }}
                  onClick={(e) => e.stopPropagation()} onChange={() => toggle(f.path, f.staged && !f.unstaged)} />
                <span className="code" style={{ color: CODE_COLOR[f.label] ?? 'var(--muted)' }} title={f.label}>{CODE_LETTER[f.label] ?? '•'}</span>
                <span className="mono ellipsis grow" style={{ fontSize: 13 }}>{f.path}</span>
                <span className="small muted">{f.label}</span>
              </div>
            ))}
          </div>
          <label className="field" htmlFor="commit-msg">Commit message</label>
          <div className="row">
            <input id="commit-msg" className="input" value={msg} placeholder="What did you change?"
              onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doCommit(false) }} />
            <button className="btn" onClick={aiMessage} disabled={aiBusy || !files.length} title="Uses claude -p to read the staged diff">
              {aiBusy ? <span className="spinner" /> : null}AI message
            </button>
          </div>
          <div className="row wrap">
            <button className="btn primary grow" disabled={!files.length || !msg.trim()} onClick={() => doCommit(false)}>Commit to {status.branch}</button>
            <button className="btn outline grow" disabled={!files.length || !msg.trim()} onClick={() => doCommit(true)}>Commit &amp; Push</button>
          </div>
        </section>
        {selected && (
          <section className="card col" aria-label="Diff">
            <div className="row">
              <h3 className="mono grow ellipsis">{selected}</h3>
              <button className="btn danger sm" onClick={discard}>Discard changes</button>
              <button className="btn ghost sm" aria-label="Close diff" onClick={() => setSelected(null)}>×</button>
            </div>
            <DiffView text={diff} />
          </section>
        )}
      </div>

      <aside className="right">
        <div className="card col">
          <h2>Branch</h2>
          <div className="small muted">On <strong style={{ color: 'var(--text)' }}>{status.branch}</strong>{status.upstream ? ` · tracking ${status.upstream}` : ''}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            <button className="btn" onClick={switchDialog}>Switch…</button>
            <button className="btn" onClick={() => ctx.newBranch()}>New branch</button>
            <button className="btn" onClick={() => ctx.goTo('merge')}>Merge…</button>
            <button className="btn" onClick={deleteDialog}>Delete…</button>
          </div>
        </div>
        <div className="card col">
          <h2>Stash</h2>
          <div className="small muted">Put unfinished work aside without committing. {stashes.length ? `${stashes.length} saved.` : 'Nothing saved.'}</div>
          <div className="row">
            <button className="btn grow" disabled={!files.length} onClick={() => run(() => call('stashPush', cwd), 'Stashed')}>Stash changes</button>
            <button className="btn grow" disabled={!stashes.length} onClick={() => run(() => call('stashPop', cwd), 'Restored stash')}>Stash pop</button>
          </div>
        </div>
        <div className="card col">
          <div className="row"><h2 className="grow">Latest version</h2><button className="btn ghost sm" onClick={() => ctx.goTo('versions')}>All versions</button></div>
          {latest ? (
            <>
              <div className="row"><span className="chip tag">{latest.name}</span><span className="small muted ellipsis">{latest.title} · {latest.date}</span></div>
              <div className="small muted">{latest.since} commit{latest.since === 1 ? '' : 's'} since {latest.name}</div>
            </>
          ) : <div className="small muted">No versions yet.</div>}
          <button className="btn violet" disabled={!status.hasCommits} onClick={() => { ctx.setVersionTarget(null); ctx.goTo('versions') }}>Save as new version</button>
        </div>
        <div className="card col">
          <h2>GitHub</h2>
          {status.remoteUrl ? (
            <>
              <div className="mono small muted ellipsis" title={status.remoteUrl}>{status.remoteUrl}</div>
              {/github\.com/.test(status.remoteUrl) && (
                <button className="btn" onClick={() => call('openUrl', status.remoteUrl!.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, ''))}>Open on GitHub</button>
              )}
            </>
          ) : (
            <>
              <div className="small muted">This project is not on GitHub yet.</div>
              <button className="btn primary" onClick={ctx.publish}>Upload to GitHub</button>
            </>
          )}
          <button className="btn ghost sm" onClick={() => call('openFolder', cwd)}>Open project folder</button>
        </div>
      </aside>
    </div>
  )
}
