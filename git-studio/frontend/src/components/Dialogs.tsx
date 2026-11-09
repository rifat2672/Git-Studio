import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { call } from '../api'

export type Values = Record<string, string | boolean>

export interface Field {
  key: string
  label: string
  type?: 'text' | 'password' | 'textarea' | 'checkbox' | 'select' | 'folder'
  value?: string | boolean
  options?: { value: string; label: string }[]
  placeholder?: string
  help?: string
  required?: boolean
}

export interface FormSpec {
  title: string
  text?: ReactNode
  fields?: Field[]
  submit?: string
  cancel?: string | null
  danger?: boolean
  wide?: boolean
  pre?: string
  /** Called on every change; may fill in other fields (e.g. folder name from a URL). */
  derive?: (v: Values, changed: string) => Values
}

export function DiffView({ text }: { text: string }) {
  return (
    <pre className="diff">
      {text.split('\n').map((l, i) => {
        const cls = l.startsWith('+') && !l.startsWith('+++') ? 'add'
          : l.startsWith('-') && !l.startsWith('---') ? 'del'
            : l.startsWith('@@') ? 'hunk' : undefined
        return <div key={i} className={cls}>{l || ' '}</div>
      })}
    </pre>
  )
}

function FormDialog({ spec, onDone }: { spec: FormSpec; onDone: (v: Values | null) => void }) {
  const [values, setValues] = useState<Values>(() => {
    const v: Values = {}
    for (const f of spec.fields ?? []) v[f.key] = f.value ?? (f.type === 'checkbox' ? false : '')
    return v
  })
  const set = (key: string, val: string | boolean): void => {
    let next = { ...values, [key]: val }
    if (spec.derive) next = spec.derive(next, key)
    setValues(next)
  }
  const missing = (spec.fields ?? []).some((f) => f.required && !String(values[f.key] ?? '').trim())
  const submit = (e?: React.FormEvent): void => {
    e?.preventDefault()
    if (!missing) onDone(values)
  }
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onDone(null) }}>
      <form className={'dialog' + (spec.wide ? ' wide' : '')} onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onDone(null)}>
        <h2>{spec.title}</h2>
        {spec.text && <div className="muted" style={{ fontSize: 13, lineHeight: 1.55 }}>{spec.text}</div>}
        {spec.pre !== undefined && <DiffView text={spec.pre} />}
        {(spec.fields ?? []).map((f, i) => {
          const id = 'f-' + f.key
          if (f.type === 'checkbox') {
            return (
              <label key={f.key} className="check">
                <input type="checkbox" checked={!!values[f.key]} onChange={(e) => set(f.key, e.target.checked)} />
                {f.label}
              </label>
            )
          }
          return (
            <label key={f.key} className="field" htmlFor={id}>
              {f.label}
              {f.type === 'textarea' ? (
                <textarea id={id} className="textarea" rows={5} value={String(values[f.key])} placeholder={f.placeholder}
                  onChange={(e) => set(f.key, e.target.value)} />
              ) : f.type === 'select' ? (
                <select id={id} className="select" value={String(values[f.key])} onChange={(e) => set(f.key, e.target.value)}>
                  {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === 'folder' ? (
                <span className="row">
                  <input id={id} className="input" value={String(values[f.key])} placeholder={f.placeholder}
                    onChange={(e) => set(f.key, e.target.value)} />
                  <button type="button" className="btn" onClick={async () => {
                    const dir = await call('pickFolder', f.label)
                    if (dir) set(f.key, dir)
                  }}>Browse…</button>
                </span>
              ) : (
                <input id={id} className="input" autoFocus={i === 0} type={f.type === 'password' ? 'password' : 'text'}
                  value={String(values[f.key])} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
              )}
              {f.help && <span className="small muted">{f.help}</span>}
            </label>
          )
        })}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {spec.cancel !== null && <button type="button" className="btn" onClick={() => onDone(null)}>{spec.cancel ?? 'Cancel'}</button>}
          <button type="submit" className={'btn ' + (spec.danger ? 'danger' : 'primary')} disabled={missing}>{spec.submit ?? 'OK'}</button>
        </div>
      </form>
    </div>
  )
}

export interface DialogApi {
  ask: (spec: FormSpec) => Promise<Values | null>
  confirm: (title: string, text: ReactNode, submit?: string, danger?: boolean) => Promise<boolean>
  show: (title: string, pre: string) => Promise<void>
}

export function useDialogs(): [DialogApi, ReactNode] {
  const [cur, setCur] = useState<{ spec: FormSpec; resolve: (v: Values | null) => void } | null>(null)
  const ask = useCallback((spec: FormSpec) => new Promise<Values | null>((resolve) => setCur({ spec, resolve })), [])
  const api: DialogApi = {
    ask,
    confirm: async (title, text, submit = 'Yes', danger = false) => (await ask({ title, text, submit, danger })) !== null,
    show: async (title, pre) => { await ask({ title, pre, submit: 'Close', cancel: null, wide: true }) }
  }
  const node = cur ? (
    <FormDialog key={cur.spec.title} spec={cur.spec} onDone={(v) => { cur.resolve(v); setCur(null) }} />
  ) : null
  return [api, node]
}

/** Browse folders on this computer through the backend (/api/fs/dirs). */
export function FolderPicker({ title, onDone }: { title: string; onDone: (path: string | null) => void }) {
  const [info, setInfo] = useState<{ path: string; parent: string | null; dirs: string[]; home: string; roots: string[]; sep: string } | null>(null)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState('')
  const open = async (p: string | null): Promise<void> => {
    try {
      const r = await call('listDirs', p)
      setInfo(r)
      setTyped(r.path)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => { open(null) }, [])
  const join = (name: string): string => (info!.path.endsWith(info!.sep) ? info!.path + name : info!.path + info!.sep + name)
  return (
    <div className="overlay" style={{ zIndex: 70 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onDone(null) }}>
      <div className="dialog" onKeyDown={(e) => e.key === 'Escape' && onDone(null)}>
        <h2>{title}</h2>
        <form className="row" onSubmit={(e) => { e.preventDefault(); open(typed) }}>
          <input className="input mono" aria-label="Folder path" value={typed} onChange={(e) => setTyped(e.target.value)} />
          <button className="btn" type="submit">Go</button>
        </form>
        {error && <div className="small" style={{ color: 'var(--red)' }}>{error}</div>}
        {info && (
          <>
            <div className="row wrap">
              <button className="btn sm" disabled={!info.parent} onClick={() => open(info.parent)}>↑ Up</button>
              <button className="btn sm" onClick={() => open(info.home)}>Home</button>
              {info.roots.length > 1 && info.roots.map((r) => <button key={r} className="btn sm" onClick={() => open(r)}>{r}</button>)}
            </div>
            <div className="card" style={{ padding: 4, maxHeight: 340, overflow: 'auto' }}>
              {info.dirs.length === 0 && <div className="small muted" style={{ padding: 10 }}>No sub-folders.</div>}
              {info.dirs.map((d) => (
                <button key={d} className="proj" onDoubleClick={() => onDone(join(d))} onClick={() => open(join(d))}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9BA3AF" strokeWidth="2" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg><span className="ellipsis">{d}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => onDone(null)}>Cancel</button>
          <button className="btn primary" disabled={!info} onClick={() => info && onDone(info.path)}>Choose this folder</button>
        </div>
      </div>
    </div>
  )
}
