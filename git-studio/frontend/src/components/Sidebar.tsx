import type { Project } from '../types'

export function Sidebar(props: {
  projects: Project[]
  currentId: string | null
  onPick: (id: string) => void
  onRemove: (p: Project) => void
  changeCount: number
  onAdd: () => void
  onClone: () => void
  onImport: () => void
  user: string | null
  onSettings: () => void
}) {
  return (
    <nav className="sidebar" aria-label="Projects">
      <div className="side-title">PROJECTS</div>
      {props.projects.length === 0 && <div className="small muted" style={{ padding: '4px 8px' }}>No projects yet.</div>}
      {props.projects.map((p) => {
        const active = p.id === props.currentId
        return (
          <div key={p.id} className={'proj' + (active ? ' active' : '')} role="button" tabIndex={0}
            onClick={() => props.onPick(p.id)} onKeyDown={(e) => e.key === 'Enter' && props.onPick(p.id)} title={p.path}>
            <span className="col grow" style={{ gap: 2 }}>
              <span className="ellipsis" style={{ fontWeight: 600 }}>{p.name}</span>
              <span className="ellipsis small muted">{p.path}</span>
            </span>
            {active && props.changeCount > 0 && <span className="mono small" style={{ color: 'var(--yellow)' }}>{props.changeCount}</span>}
            <button className="btn ghost sm x" aria-label={`Remove ${p.name} from list`} style={{ minHeight: 24, padding: '0 6px' }}
              onClick={(e) => { e.stopPropagation(); props.onRemove(p) }}>×</button>
          </div>
        )
      })}
      <div style={{ height: 1, background: 'var(--border)', margin: '10px 0' }} />
      <button className="btn dashed" onClick={props.onAdd}>+ Add folder</button>
      <button className="btn dashed" onClick={props.onClone}>Clone from URL</button>
      <button className="btn dashed" onClick={props.onImport}>Import another repo</button>
      <span className="grow" />
      <button className="proj" onClick={props.onSettings} style={{ background: 'var(--panel)' }}>
        <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#2b3445', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flex: 'none' }}>
          {props.user ? props.user[0].toUpperCase() : '⚙'}
        </span>
        <span className="col" style={{ gap: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{props.user ? `GitHub: ${props.user}` : 'Connect GitHub'}</span>
          <span className="small muted">Settings</span>
        </span>
      </button>
    </nav>
  )
}
