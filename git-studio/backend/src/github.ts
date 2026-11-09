// Small GitHub REST client (uses the token saved in Settings).
import { logStart } from './git'

const API = 'https://api.github.com'

async function call<T>(token: string | null, method: string, url: string, body?: unknown): Promise<T> {
  if (!token) throw new Error('Add a GitHub token in Settings first (gear icon, bottom left).')
  const res = await fetch(API + url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'git-studio',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) {
    const details = Array.isArray(json.errors) ? ' - ' + json.errors.map((e: { message?: string; code?: string }) => e.message || e.code).join(', ') : ''
    throw new Error(`GitHub: ${json.message ?? res.statusText}${details}`)
  }
  return json as T
}

export async function getUser(token: string): Promise<string> {
  const u = await call<{ login: string }>(token, 'GET', '/user')
  return u.login
}

export async function createRepo(
  token: string | null, cwd: string, name: string, isPrivate: boolean, description: string
): Promise<{ cloneUrl: string; htmlUrl: string }> {
  const done = logStart(cwd, `GitHub API: create ${isPrivate ? 'private' : 'public'} repo "${name}"`)
  try {
    const r = await call<{ clone_url: string; html_url: string }>(token, 'POST', '/user/repos', {
      name, private: isPrivate, description, auto_init: false
    })
    done(true, r.html_url)
    return { cloneUrl: r.clone_url, htmlUrl: r.html_url }
  } catch (e) {
    done(false, (e as Error).message)
    throw e
  }
}

export async function createRelease(
  token: string | null, cwd: string, owner: string, repo: string, tag: string, title: string, notes: string
): Promise<string> {
  const done = logStart(cwd, `GitHub API: create release ${tag} on ${owner}/${repo}`)
  try {
    const r = await call<{ html_url: string }>(token, 'POST', `/repos/${owner}/${repo}/releases`, {
      tag_name: tag, name: title ? `${tag} - ${title}` : tag, body: notes
    })
    done(true, r.html_url)
    return r.html_url
  } catch (e) {
    done(false, (e as Error).message)
    throw e
  }
}
