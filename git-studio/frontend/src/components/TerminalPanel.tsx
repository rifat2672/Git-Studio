import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { api } from '../api'
import type { LogEntry, PtyKind } from '../types'

export type TermTab = 'activity' | PtyKind

export interface OpenTerm { key: string; kind: PtyKind; cwd: string; projectId: string }

// One listener for all terminals; each XTerm registers itself here.
const writers = new Map<string, (d: string) => void>()
const buffers = new Map<string, string>()
api.pty.onData((key, data) => {
  const w = writers.get(key)
  if (w) w(data)
  else buffers.set(key, (buffers.get(key) ?? '') + data)
})

function XTerm({ t, visible }: { t: OpenTerm; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      theme: { background: '#0b0d11', foreground: '#e6edf3', cursor: '#5b9dff', selectionBackground: '#2b3a55' }
    })
    const fit = new FitAddon()
    fitRef.current = fit
    termRef.current = term
    term.loadAddon(fit)
    term.open(host.current!)
    try { fit.fit() } catch { /* hidden */ }
    writers.set(t.key, (d) => term.write(d))
    const buffered = buffers.get(t.key)
    if (buffered) { term.write(buffered); buffers.delete(t.key) }
    term.onData((d) => api.pty.write(t.key, d))
    term.onResize(({ cols, rows }) => api.pty.resize(t.key, cols, rows))
    api.pty.start(t.key, t.kind, t.projectId, term.cols || 100, term.rows || 20)
    const exitOff = api.pty.onExit((k) => {
      if (k === t.key) term.write('\r\n\x1b[90m[process ended - close this tab with × and open it again]\x1b[0m\r\n')
    })
    const ro = new ResizeObserver(() => {
      if (host.current && host.current.offsetWidth > 0) { try { fit.fit() } catch { /* ignore */ } }
    })
    ro.observe(host.current!)
    return () => {
      ro.disconnect()
      exitOff()
      writers.delete(t.key)
      term.dispose()
    }
  }, [t.key])

  useEffect(() => {
    if (visible) setTimeout(() => { try { fitRef.current?.fit(); termRef.current?.focus() } catch { /* ignore */ } }, 0)
  }, [visible])

  return <div className="xterm-host" ref={host} style={{ visibility: visible ? 'visible' : 'hidden' }} />
}

function Activity({ logs, onFix }: { logs: LogEntry[]; onFix: (kind: PtyKind, e: LogEntry) => void }) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [logs.length, logs[logs.length - 1]?.status])
  if (!logs.length) {
    return <div className="activity muted">Every git command the buttons run shows up here.</div>
  }
  return (
    <div className="activity">
      {logs.map((e, i) => (
        <div key={e.id}>
          <div className="row" style={{ gap: 10 }}>
            <span className="muted">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <span className="log-cmd">$ {e.cmd}</span>
            {e.status === 'running' && <span className="spinner" />}
            {e.status === 'ok' && <span style={{ color: 'var(--green)' }}>✓</span>}
            {e.status === 'error' && <span style={{ color: 'var(--red)' }}>✗</span>}
          </div>
          {e.output && (
            <pre className="log-out" style={{ color: e.status === 'error' ? '#ff9b94' : '#c2c9d3' }}>{e.output}</pre>
          )}
          {e.status === 'error' && i >= logs.length - 3 && (
            <div className="log-fix">
              <span className="grow small" style={{ color: '#ffb4ae' }}>This command failed. Ask AI to look at it:</span>
              <button className="btn sm claude" onClick={() => onFix('claude', e)}>Fix with Claude</button>
              <button className="btn sm codex" onClick={() => onFix('codex', e)}>Fix with Codex</button>
            </div>
          )}
        </div>
      ))}
      <div ref={end} />
    </div>
  )
}

export function TerminalPanel(props: {
  height: number
  setHeight: (h: number) => void
  tab: TermTab
  setTab: (t: TermTab) => void
  logs: LogEntry[]
  allLogs: boolean
  setAllLogs: (b: boolean) => void
  clearLogs: () => void
  terms: OpenTerm[]
  projectId: string | null
  closeTerm: (key: string) => void
  onFix: (kind: PtyKind, e: LogEntry) => void
}) {
  const { height, tab, setTab, terms, projectId } = props
  const startDrag = (ev: React.MouseEvent): void => {
    const y0 = ev.clientY
    const h0 = height
    const move = (e: MouseEvent): void => props.setHeight(Math.min(Math.max(h0 + (y0 - e.clientY), 120), window.innerHeight - 220))
    const up = (): void => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const tabs: { id: TermTab; label: string }[] = [
    { id: 'activity', label: 'Activity' }, { id: 'claude', label: 'Claude' }, { id: 'codex', label: 'Codex' }, { id: 'shell', label: 'Shell' }
  ]
  const currentKey = projectId && tab !== 'activity' ? `${projectId}:${tab}` : null
  return (
    <section className="term" style={{ height }} aria-label="Terminal">
      <div className="resize-bar" onMouseDown={startDrag} title="Drag to resize" />
      <div className="term-tabs" role="tablist">
        {tabs.map((t) => {
          const open = projectId && t.id !== 'activity' && terms.some((x) => x.key === `${projectId}:${t.id}`)
          return (
            <span key={t.id} className="row" style={{ gap: 0 }}>
              <button role="tab" className={'term-tab' + (tab === t.id ? ' active' : '')} onClick={() => setTab(t.id)}>
                {t.label}{open ? ' ●' : ''}
              </button>
              {open && (
                <button className="btn ghost sm" aria-label={`Close ${t.label}`} style={{ minHeight: 24, padding: '0 6px' }}
                  onClick={() => props.closeTerm(`${projectId}:${t.id}`)}>×</button>
              )}
            </span>
          )
        })}
        <span className="grow" />
        {tab === 'activity' && (
          <>
            <label className="check small muted" style={{ marginRight: 8 }}>
              <input type="checkbox" checked={props.allLogs} onChange={(e) => props.setAllLogs(e.target.checked)} /> All projects
            </label>
            <button className="btn ghost sm" onClick={props.clearLogs}>Clear</button>
          </>
        )}
      </div>
      <div className="term-body">
        {tab === 'activity' && <Activity logs={props.logs} onFix={props.onFix} />}
        {terms.map((t) => <XTerm key={t.key} t={t} visible={t.key === currentKey} />)}
        {tab !== 'activity' && !projectId && <div className="activity muted">Open a project first.</div>}
      </div>
    </section>
  )
}
