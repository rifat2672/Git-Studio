import { useCallback, useEffect, useRef, useState } from 'react'
import { api, call, setFolderPicker } from './api'
import type { BranchInfo, LogEntry, Project, PtyKind, Settings, StatusInfo } from './types'
import { useDialogs, FolderPicker } from './components/Dialogs'
import { TerminalPanel, type OpenTerm, type TermTab } from './components/TerminalPanel'
import { Sidebar } from './components/Sidebar'
import { ChangesView } from './components/ChangesView'
import { HistoryView } from './components/HistoryView'
import { VersionsView } from './components/VersionsView'
import { MergeView } from './components/MergeView'
import { oneLine, type Ctx, type MainTab } from './ctx'

const EMPTY: StatusInfo = {
  isRepo: false, branch: '', upstream: null, ahead: 0, behind: 0, files: [], merging: false, hasCommits: false, remoteUrl: null
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5B9DFF" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="9" r="2.5" />
      <path d="M6 8.5v7M18 11.5c0 4-6 3-12 4" />
    </svg>
  )
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusInfo>(EMPTY)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [tab, setTab] = useState<MainTab>('changes')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [allLogs, setAllLogs] = useState(false)
  const [termTab, setTermTab] = useState<TermTab>('activity')
  const [termHeight, setTermHeight] = useState(280)
  const [terms, setTerms] = useState<OpenTerm[]>([])
  const [toast, setToast] = useState<{ text: string; err: boolean } | null>(null)
  const [busy, setBusy] = useState(0)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [versionTarget, setVersionTarget] = useState<string | null>(null)
  const [dialogs, dialogNode] = useDialogs()
  const [picker, setPicker] = useState<{ title: string; resolve: (p: string | null) => void } | null>(null)
  useEffect(() => setFolderPicker((title) => new Promise((resolve) => setPicker({ title, resolve }))), [])
  const project = projects.find((p) => p.id === currentId) ?? null
  const projectRef = useRef(project)
  projectRef.current = project

  // ---------------------------------------------------------------- data
  useEffect(() => {
    call('listProjects').catch(() => [] as Project[]).then((p) => {
      setProjects(p)
      const last = localStorage.getItem('lastProject')
      setCurrentId(p.find((x) => x.id === last)?.id ?? p[0]?.id ?? null)
    })
    call('settings').then(setSettings).catch((e) => setToast({ text: (e as Error).message, err: true }))
    call('logs').then((l) => setLogs((prev) => [...l.filter((x) => !prev.some((y) => y.id === x.id)), ...prev])).catch(() => {})
    return api.onLog((e) => setLogs((prev) => {
      const i = prev.findIndex((x) => x.id === e.id)
      if (i >= 0) { const n = prev.slice(); n[i] = e; return n }
      return [...prev.slice(-499), e]
    }))
  }, [])

  const refresh = useCallback(async () => {
    const p = projectRef.current
    if (!p) { setStatus(EMPTY); setBranches([]); return }
    try {
      const st = await call('status', p.id)
      if (projectRef.current?.id !== p.id) return
      setStatus(st)
      setBranches(st.isRepo ? await call('branches', p.id) : [])
    } catch (e) {
      setStatus(EMPTY)
      setToast({ text: (e as Error).message, err: true })
    }
  }, [])

  useEffect(() => {
    if (currentId) localStorage.setItem('lastProject', currentId)
    setStatus(EMPTY)
    refresh()
  }, [currentId, refresh])

  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible' && busy === 0) refresh() }, 4000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(t); window.removeEventListener('focus', refresh) }
  }, [busy, refresh])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.err ? 9000 : 3500)
    return () => clearTimeout(t)
  }, [toast])

  const run = useCallback(async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
    setBusy((b) => b + 1)
    try {
      const r = await fn()
      if (okMsg) setToast({ text: okMsg, err: false })
      return r
    } catch (e) {
      setToast({ text: (e as Error).message, err: true })
      return undefined
    } finally {
      setBusy((b) => b - 1)
      await refresh()
    }
  }, [refresh])

  // ---------------------------------------------------------------- terminals & AI
  const openTerm = (kind: PtyKind): boolean => {
    const p = projectRef.current
    if (!p) return false
    const key = `${p.id}:${kind}`
    if (terms.some((t) => t.key === key)) return false
    setTerms((prev) => (prev.some((t) => t.key === key) ? prev : [...prev, { key, kind, cwd: p.path, projectId: p.id }]))
    return true
  }

  const chooseTermTab = (t: TermTab): void => {
    setTermTab(t)
    if (t !== 'activity') openTerm(t)
  }

  const askAI = (kind: PtyKind, prompt: string): void => {
    const p = projectRef.current
    if (!p) return
    const isNew = openTerm(kind)
    setTermTab(kind)
    const key = `${p.id}:${kind}`
    // A new tab needs a few seconds for the CLI to start before it can take input.
    setTimeout(() => {
      api.pty.write(key, oneLine(prompt, 4000))
      setTimeout(() => api.pty.write(key, '\r'), 400)
    }, isNew ? 4500 : 150)
  }

  const fixLog = (kind: PtyKind, e: LogEntry): void => {
    const files = status.files.slice(0, 30).map((f) => `${f.code.trim() || '?'} ${f.path}`).join(', ')
    askAI(kind,
      `I use a git GUI. In the repo at ${e.cwd} this command failed: "${e.cmd}". ` +
      `Output: ${oneLine(e.output, 1800)}. Current branch: ${status.branch || 'unknown'}` +
      `${status.upstream ? `, tracking ${status.upstream} (ahead ${status.ahead}, behind ${status.behind})` : ''}. ` +
      `Changed files: ${files || 'none'}. Explain the problem in simple words and fix it. ` +
      'Ask me before anything destructive (force push, reset --hard, deleting files or branches).')
  }

  const closeTerm = (key: string): void => {
    api.pty.kill(key)
    setTerms((prev) => prev.filter((t) => t.key !== key))
  }

  // ---------------------------------------------------------------- shared flows
  const ensureToken = async (): Promise<boolean> => {
    if (settings?.githubToken) return true
    await openSettings('Add a GitHub token first. The app needs it to create repos and releases on your account.')
    const s = await call('settings')
    setSettings(s)
    return !!s.githubToken
  }

  const openSettings = async (note?: string): Promise<void> => {
    const v = await dialogs.ask({
      title: 'Settings',
      text: note ?? (settings?.githubUser ? `Connected to GitHub as ${settings.githubUser}.` : 'Not connected to GitHub yet.'),
      fields: [
        {
          key: 'token', label: 'GitHub personal access token', type: 'password',
          placeholder: settings?.githubToken ? 'saved - leave empty to keep' : 'ghp_… or github_pat_…',
          help: 'Create one at github.com → Settings → Developer settings → Personal access tokens. Classic token: tick "repo". It is stored encrypted with your OS keychain.'
        },
        { key: 'clear', label: 'Remove saved token', type: 'checkbox' },
        {
          key: 'pull', label: 'When pulling', type: 'select', value: settings?.pullMode ?? 'merge',
          options: [{ value: 'merge', label: 'Merge (safe default)' }, { value: 'rebase', label: 'Rebase (straight history)' }]
        }
      ],
      submit: 'Save'
    })
    if (!v) return
    await run(async () => {
      if (v.clear) await call('setToken', '')
      else if (String(v.token).trim()) {
        const user = await call('setToken', String(v.token))
        setToast({ text: `Connected as ${user}`, err: false })
      }
      await call('setPullMode', v.pull as 'merge' | 'rebase')
      setSettings(await call('settings'))
    })
  }

  const switchBranch = async (name: string): Promise<void> => {
    const p = projectRef.current
    if (!p) return
    let stash = false
    if (status.files.some((f) => f.label !== 'Untracked')) {
      const v = await dialogs.ask({
        title: `Switch to ${name}?`,
        text: 'You have changes that are not committed yet.',
        fields: [{
          key: 'how', label: 'What should happen to them?', type: 'select', value: 'stash',
          options: [
            { value: 'stash', label: 'Put them aside (stash). Get them back later with "Stash pop".' },
            { value: 'carry', label: 'Take them with me to the other branch' }
          ]
        }],
        submit: 'Switch'
      })
      if (!v) return
      stash = v.how === 'stash'
    }
    await run(() => call('switchBranch', p.id, name, stash), `Now on ${name.replace(/^[^/]+\//, '')}`)
  }

  const newBranch = async (base?: string | null): Promise<void> => {
    const p = projectRef.current
    if (!p) return
    const local = branches.filter((b) => !b.remote)
    const v = await dialogs.ask({
      title: 'New branch',
      fields: [
        { key: 'name', label: 'Branch name', placeholder: 'feature/payment', required: true, help: 'No spaces. Example: feature/login, fix/cart-total' },
        ...(base ? [] : [{
          key: 'base', label: 'Start from', type: 'select' as const, value: status.branch,
          options: [...local, ...branches.filter((b) => b.remote)].map((b) => ({ value: b.name, label: b.name + (b.current ? ' (current)' : '') }))
        }])
      ],
      submit: 'Create and switch'
    })
    if (!v) return
    const name = String(v.name).trim().replace(/\s+/g, '-')
    await run(() => call('createBranch', p.id, name, base ?? (String(v.base) || null)), `Created ${name}`)
  }

  const publish = async (): Promise<void> => {
    const p = projectRef.current
    if (!p || !(await ensureToken())) return
    const v = await dialogs.ask({
      title: 'Upload to GitHub',
      text: 'Creates a new repository on your GitHub account and uploads this project. If the folder is not a git repo yet, it is set up first.',
      fields: [
        { key: 'name', label: 'Repository name', value: p.name.replace(/\s+/g, '-'), required: true },
        { key: 'desc', label: 'Description (optional)' },
        { key: 'private', label: 'Private repository', type: 'checkbox', value: true }
      ],
      submit: 'Create and upload'
    })
    if (!v) return
    const url = await run(() => call('publishToGithub', p.id, String(v.name).trim(), !!v.private, String(v.desc)))
    if (url) setToast({ text: `Uploaded: ${url}`, err: false })
  }

  // ---------------------------------------------------------------- projects
  const addFolder = async (): Promise<void> => {
    const dir = await call('pickFolder', 'Choose a project folder')
    if (!dir) return
    const p = await run(() => call('addProject', dir))
    if (p) { setProjects(await call('listProjects')); setCurrentId(p.id) }
  }

  const cloneRepo = async (): Promise<void> => {
    const v = await dialogs.ask({
      title: 'Clone a repository',
      fields: [
        { key: 'url', label: 'Repository URL', placeholder: 'https://github.com/user/repo.git', required: true },
        { key: 'parent', label: 'Save inside folder', type: 'folder', required: true },
        { key: 'folder', label: 'Folder name', required: true }
      ],
      derive: (vals, changed) => changed === 'url'
        ? { ...vals, folder: String(vals.url).trim().replace(/\/+$/, '').split(/[/:]/).pop()?.replace(/\.git$/, '') ?? '' }
        : vals,
      submit: 'Clone'
    })
    if (!v) return
    setTermTab('activity')
    const p = await run(() => call('cloneRepo', String(v.url), String(v.parent), String(v.folder)), 'Cloned')
    if (p) { setProjects(await call('listProjects')); setCurrentId(p.id) }
  }

  const importRepo = async (): Promise<void> => {
    const m = await dialogs.ask({
      title: 'Import another repo',
      text: 'Bring code from someone else\'s repository.',
      fields: [{
        key: 'mode', label: 'What do you want?', type: 'select', value: 'mine',
        options: [
          { value: 'mine', label: 'Copy it into a NEW repo on my GitHub (keeps full history)' },
          { value: 'remote', label: 'Add it to the current project, so I can merge or copy commits from it' }
        ]
      }],
      submit: 'Next'
    })
    if (!m) return
    if (m.mode === 'remote') {
      const p = projectRef.current
      if (!p) { setToast({ text: 'Open a project first.', err: true }); return }
      const v = await dialogs.ask({
        title: `Add a repo to ${p.name}`,
        text: 'After this, its branches appear as "name/branch" in Merge and History. Merge them, or copy single commits with "Copy to current branch".',
        fields: [
          { key: 'url', label: 'Repository URL', required: true },
          { key: 'name', label: 'Short name for it', value: 'upstream', required: true }
        ],
        submit: 'Add and fetch'
      })
      if (v) await run(() => call('addRemote', p.id, String(v.name), String(v.url)), 'Fetched. Its branches are now in the branch lists.')
      return
    }
    if (!(await ensureToken())) return
    const v = await dialogs.ask({
      title: 'Copy into my GitHub',
      text: 'Clones the repo, keeps the original as "upstream", creates a new repo on your account and uploads everything. Respect the original project\'s license.',
      fields: [
        { key: 'url', label: 'Repository URL', required: true },
        { key: 'parent', label: 'Save inside folder', type: 'folder', required: true },
        { key: 'folder', label: 'New repo / folder name', required: true },
        { key: 'private', label: 'Private repository', type: 'checkbox', value: true }
      ],
      derive: (vals, changed) => changed === 'url'
        ? { ...vals, folder: String(vals.url).trim().replace(/\/+$/, '').split(/[/:]/).pop()?.replace(/\.git$/, '') ?? '' }
        : vals,
      submit: 'Import'
    })
    if (!v) return
    setTermTab('activity')
    const p = await run(() => call('importAsMine', String(v.url), String(v.parent), String(v.folder), !!v.private), 'Imported to your GitHub')
    if (p) { setProjects(await call('listProjects')); setCurrentId(p.id) }
  }

  const removeProject = async (p: Project): Promise<void> => {
    if (!(await dialogs.confirm(`Remove ${p.name} from the list?`, 'Only removes it from Git Studio. Files on disk are not touched.', 'Remove'))) return
    await call('removeProject', p.id)
    const list = await call('listProjects')
    setProjects(list)
    if (currentId === p.id) setCurrentId(list[0]?.id ?? null)
  }

  // ---------------------------------------------------------------- render
  const ctx: Ctx | null = project ? {
    project, status, branches, refresh, run, dialogs, askAI, goTo: setTab,
    switchBranch, newBranch, publish, versionTarget, setVersionTarget
  } : null

  const shownLogs = allLogs || !project ? logs : logs.filter((l) => l.cwd === project.path || l.cwd.startsWith(project.path))
  const local = branches.filter((b) => !b.remote)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><Logo />Git Studio</div>
        {project && (
          <div className="pill"><span className="muted">Project</span><strong>{project.name}</strong></div>
        )}
        {project && status.isRepo && (
          <div className="pill">
            <span className="dot" style={{ background: 'var(--accent)' }} />
            <select aria-label="Current branch" value={status.branch}
              onChange={(e) => e.target.value === '__new' ? newBranch() : switchBranch(e.target.value)}>
              {!local.some((b) => b.name === status.branch) && <option value={status.branch}>{status.branch}</option>}
              {local.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
              <option value="__new">+ New branch…</option>
            </select>
          </div>
        )}
        {project && status.isRepo && (
          <span className="mono small muted">
            {status.upstream ? `↑${status.ahead} to push · ↓${status.behind} to pull` : status.remoteUrl ? 'branch not on GitHub yet' : 'no remote'}
          </span>
        )}
        <span className="grow" />
        {busy > 0 && <span className="spinner" title="Working…" />}
        {project && status.isRepo && (
          <div className="row">
            <button className="btn" onClick={() => run(() => call('fetch', project.id), 'Fetched')} disabled={!status.remoteUrl}>Fetch</button>
            <button className="btn" onClick={() => run(() => call('pull', project.id), 'Pulled')} disabled={!status.upstream}>
              Pull{status.behind ? ` (${status.behind})` : ''}
            </button>
            {status.remoteUrl ? (
              <button className="btn primary" onClick={() => run(() => call('push', project.id), 'Pushed')} disabled={!status.hasCommits}>
                Push{status.ahead ? ` (${status.ahead})` : !status.upstream ? ' branch' : ''}
              </button>
            ) : (
              <button className="btn primary" onClick={publish}>Upload to GitHub</button>
            )}
          </div>
        )}
      </header>

      <div className="body">
        <Sidebar
          projects={projects} currentId={currentId} onPick={setCurrentId} onRemove={removeProject}
          changeCount={status.files.length} onAdd={addFolder} onClone={cloneRepo} onImport={importRepo}
          user={settings?.githubUser ?? null} onSettings={() => openSettings()}
        />
        <main className="main">
          {ctx ? (
            <>
              <nav className="tabs" role="tablist">
                {(['changes', 'history', 'versions', 'merge'] as MainTab[]).map((t) => (
                  <button key={t} role="tab" className={'tab' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>
                    {t[0].toUpperCase() + t.slice(1)}
                    {t === 'changes' && status.files.length > 0 && <span className="muted"> ({status.files.length})</span>}
                    {t === 'merge' && status.merging && <span className="badge">conflict</span>}
                  </button>
                ))}
              </nav>
              <div className="content">
                {tab === 'changes' && <ChangesView ctx={ctx} />}
                {tab === 'history' && <HistoryView ctx={ctx} />}
                {tab === 'versions' && <VersionsView ctx={ctx} />}
                {tab === 'merge' && <MergeView ctx={ctx} />}
              </div>
            </>
          ) : (
            <div className="empty col" style={{ alignItems: 'center', margin: 'auto' }}>
              <h2 style={{ color: 'var(--text)', margin: 0 }}>Welcome to Git Studio</h2>
              <p>Add a project folder, clone a repo, or import one to start.</p>
              <div className="row">
                <button className="btn primary" onClick={addFolder}>Add folder</button>
                <button className="btn" onClick={cloneRepo}>Clone from URL</button>
              </div>
            </div>
          )}
          <TerminalPanel
            height={termHeight} setHeight={setTermHeight} tab={termTab} setTab={chooseTermTab}
            logs={shownLogs} allLogs={allLogs} setAllLogs={setAllLogs} clearLogs={() => setLogs([])}
            terms={terms} projectId={currentId} closeTerm={closeTerm} onFix={fixLog}
          />
        </main>
      </div>

      {toast && (
        <div className={'toast' + (toast.err ? ' err' : '')} role="status">
          <span className="grow" style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{toast.text}</span>
          <button className="btn ghost sm" aria-label="Close" onClick={() => setToast(null)}>×</button>
        </div>
      )}
      {dialogNode}
      {picker && <FolderPicker title={picker.title} onDone={(p) => { picker.resolve(p); setPicker(null) }} />}
    </div>
  )
}
