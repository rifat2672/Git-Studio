import { useEffect, useMemo, useState } from 'react'
import { call } from '../api'
import type { Ctx } from '../ctx'
import type { CommitDetails, CommitRow } from '../types'
import { buildGraph, laneColor, type GraphRow } from '../graph'

const LANE_W = 16
const ROW_H = 34

function GraphCell({ row, width, merge }: { row: GraphRow; width: number; merge: boolean }) {
  const x = (i: number): number => 10 + i * LANE_W
  const y = (v: 0 | 1 | 2): number => (v * ROW_H) / 2
  return (
    <svg width={width} height={ROW_H} aria-hidden="true" style={{ display: 'block' }}>
      {row.segments.map((s, i) => {
        const x1 = x(s.x1), x2 = x(s.x2), y1 = y(s.y1), y2 = y(s.y2)
        const d = x1 === x2 ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`
        return <path key={i} d={d} stroke={laneColor(s.lane)} strokeWidth={2} fill="none" />
      })}
      <circle cx={x(row.lane)} cy={ROW_H / 2} r={merge ? 4.5 : 5} fill={merge ? '#171a21' : laneColor(row.lane)}
        stroke={laneColor(row.lane)} strokeWidth={2} />
    </svg>
  )
}

export function HistoryView({ ctx }: { ctx: Ctx }) {
  const { project, run, dialogs, status } = ctx
  const cwd = project.id
  const [branch, setBranch] = useState('')
  const [query, setQuery] = useState('')
  const [author, setAuthor] = useState('')
  const [commits, setCommits] = useState<CommitRow[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [details, setDetails] = useState<CommitDetails | null>(null)
  const [loading, setLoading] = useState(true)

  const headKey = `${status.branch}|${status.ahead}|${status.behind}|${status.hasCommits}|${status.merging}`
  useEffect(() => {
    setLoading(true)
    call('log', cwd, branch || null, 400).then((c) => { setCommits(c); setLoading(false) }).catch(() => setLoading(false))
  }, [cwd, branch, headKey])

  useEffect(() => {
    if (!sel) { setDetails(null); return }
    call('commitDetails', cwd, sel).then(setDetails).catch(() => setDetails(null))
  }, [sel, cwd])

  const graph = useMemo(() => buildGraph(commits), [commits])
  const authors = useMemo(() => [...new Set(commits.map((c) => c.author))].sort(), [commits])
  const q = query.trim().toLowerCase()
  const filtering = !!q || !!author
  const visible = commits
    .map((c, i) => ({ c, g: graph.rows[i] }))
    .filter(({ c }) => (!author || c.author === author) &&
      (!q || c.subject.toLowerCase().includes(q) || c.hash.startsWith(q) || c.refs.some((r) => r.toLowerCase().includes(q)) || c.tags.some((t) => t.toLowerCase().includes(q))))
  const graphW = filtering ? 24 : Math.min(20 + graph.maxLanes * LANE_W, 220)
  const selCommit = commits.find((c) => c.hash === sel)

  const branchColor = (name: string): string => {
    const i = commits.findIndex((c) => c.refs.includes(name))
    return i >= 0 ? laneColor(graph.rows[i].lane) : 'var(--muted)'
  }

  const act = {
    diff: async () => sel && dialogs.show(`Commit ${sel.slice(0, 7)}`, await call('showCommitDiff', cwd, sel)),
    branch: () => sel && ctx.newBranch(sel),
    cherry: async () => {
      if (!sel || !selCommit) return
      if (await dialogs.confirm('Copy this commit to the current branch?',
        `"${selCommit.subject}" will be applied on top of ${status.branch} as a new commit (git cherry-pick).`, 'Copy commit')) {
        await run(() => call('cherryPick', cwd, sel), 'Commit copied')
      }
    },
    revert: async () => {
      if (!sel || !selCommit) return
      if (await dialogs.confirm('Undo this commit?',
        `A new commit will be added on ${status.branch} that reverses "${selCommit.subject}". The original commit stays in history.`, 'Undo it')) {
        await run(() => call('revert', cwd, sel, selCommit.parents.length > 1), 'Commit undone')
      }
    },
    version: () => { if (sel) { ctx.setVersionTarget(sel); ctx.goTo('versions') } },
    explain: () => sel && ctx.askAI('claude',
      `Explain in simple words what git commit ${sel} changed and why it might have been made. Run "git show ${sel}" to read it. Do not change any files.`)
  }

  if (!status.hasCommits) return <div className="empty">No commits yet. Make your first commit in the Changes tab.</div>

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row wrap" style={{ alignItems: 'flex-end', gap: 12 }}>
        <label className="field" style={{ minWidth: 200 }}>Branch
          <select className="select" value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">All branches</option>
            {ctx.branches.map((b) => <option key={b.name} value={b.name}>{b.name}{b.current ? ' (current)' : ''}</option>)}
          </select>
        </label>
        <label className="field grow" style={{ minWidth: 220 }}>Search message, branch, version or hash
          <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. payment, v1.2.0, 7c2e1d9" />
        </label>
        <label className="field" style={{ minWidth: 160 }}>Author
          <select className="select" value={author} onChange={(e) => setAuthor(e.target.value)}>
            <option value="">Everyone</option>
            {authors.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>

      <div className="split">
        <section className="card left" style={{ padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 470px)', minHeight: 260 }} aria-label="Commit graph">
          <div style={{ minWidth: 700, ['--graph-w' as string]: `${graphW}px` }}>
            <div className="hist-head"><span>GRAPH</span><span>COMMIT</span><span>AUTHOR</span><span>WHEN</span><span>HASH</span></div>
            {loading && !commits.length && <div className="empty">Loading…</div>}
            {visible.map(({ c, g }) => (
              <button key={c.hash} className={'hist-row' + (sel === c.hash ? ' sel' : '')} onClick={() => setSel(c.hash)}>
                {filtering
                  ? <span className="dot" style={{ background: laneColor(g.lane), marginLeft: 6 }} />
                  : <GraphCell row={g} width={graphW} merge={c.parents.length > 1} />}
                <span className="row" style={{ minWidth: 0, gap: 6 }}>
                  {c.refs.map((r) => (
                    <span key={r} className="chip" style={{ background: '#1c2433', color: branchColor(r), border: `1px solid ${branchColor(r)}55` }}>{r}</span>
                  ))}
                  {c.tags.map((t) => <span key={t} className="chip tag">{t}</span>)}
                  <span className="ellipsis">{c.subject}</span>
                </span>
                <span className="ellipsis small" style={{ color: '#c2c9d3' }}>{c.author}</span>
                <span className="small muted">{c.date}</span>
                <span className="mono small muted">{c.short}</span>
              </button>
            ))}
            {commits.length >= 400 && <div className="small muted" style={{ padding: 10 }}>Showing the latest 400 commits.</div>}
          </div>
        </section>

        <aside className="right card" aria-label="Commit details" style={{ gap: 12 }}>
          {!details || !selCommit ? (
            <div className="muted">Click a commit to see which branch it was made on, its version and the files it changed.</div>
          ) : (
            <>
              <div className="mono small muted">{details.hash.slice(0, 12)}</div>
              <h2 style={{ fontSize: 16, lineHeight: 1.35 }}>{details.subject}</h2>
              {details.body && <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{details.body}</div>}
              <div className="kv">
                <span className="muted">Made on</span><strong style={{ color: branchColor(details.madeOn) }}>{details.madeOn}</strong>
                <span className="muted">Now in</span><span>{details.containedIn.join(', ') || '-'}</span>
                <span className="muted">Author</span><span className="ellipsis">{details.author}</span>
                <span className="muted">Date</span><span>{details.date}</span>
                <span className="muted">Version</span><span>{details.version ? <span className="chip tag">{details.version}</span> : 'not in a version yet'}</span>
                {selCommit.parents.length > 1 && <><span className="muted">Type</span><span>Merge commit</span></>}
              </div>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                <div className="small muted" style={{ fontWeight: 600, letterSpacing: '0.05em', marginBottom: 4 }}>FILES CHANGED ({details.files.length})</div>
                <div style={{ maxHeight: 160, overflow: 'auto' }}>
                  {details.files.map((f) => (
                    <div key={f.path} className="row mono small" style={{ padding: '3px 0' }}>
                      <span className="ellipsis grow">{f.path}</span>
                      <span style={{ color: 'var(--green)' }}>+{f.added}</span><span style={{ color: 'var(--red)' }}>−{f.removed}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                <button className="btn" onClick={act.diff}>View diff</button>
                <button className="btn" onClick={act.branch}>New branch from here</button>
                <button className="btn" onClick={act.cherry}>Copy to current branch</button>
                <button className="btn" onClick={act.revert}>Undo this commit</button>
                <button className="btn violet" onClick={act.version}>Mark as version</button>
                <button className="btn claude" onClick={act.explain}>Explain with Claude</button>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
