// Saves the project list and settings in ~/.git-studio/config.json.
// The file is created with owner-only permissions because it holds the GitHub token.
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import type { Project, Settings } from './types'

interface Saved {
  projects: Project[]
  githubToken: string | null
  githubUser: string | null
  pullMode: 'merge' | 'rebase'
}

export const configDir = process.env.GIT_STUDIO_HOME || path.join(os.homedir(), '.git-studio')
const file = path.join(configDir, 'config.json')
let data: Saved = { projects: [], githubToken: null, githubUser: null, pullMode: 'merge' }

export async function load(): Promise<void> {
  try {
    data = { ...data, ...JSON.parse(await fs.readFile(file, 'utf8')) }
  } catch {
    /* first run */
  }
}

async function save(): Promise<void> {
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 })
  await fs.writeFile(file, JSON.stringify(data, null, 2), { mode: 0o600 })
}

export const projects = (): Project[] => data.projects

export function projectById(id: string): Project {
  const p = data.projects.find((x) => x.id === id)
  if (!p) throw Object.assign(new Error('Project not found. Add it first.'), { status: 404 })
  return p
}

export async function addProject(dir: string): Promise<Project> {
  const full = path.resolve(dir)
  const st = await fs.stat(full).catch(() => null)
  if (!st?.isDirectory()) throw new Error(`Folder not found: ${full}`)
  const existing = data.projects.find((p) => path.resolve(p.path) === full)
  if (existing) return existing
  const p: Project = { id: randomUUID(), name: path.basename(full), path: full }
  data.projects.push(p)
  await save()
  return p
}

export async function removeProject(id: string): Promise<void> {
  data.projects = data.projects.filter((p) => p.id !== id)
  await save()
}

export const token = (): string | null => data.githubToken

export async function setToken(t: string | null, user: string | null): Promise<void> {
  data.githubToken = t
  data.githubUser = user
  await save()
}

export function settings(): Settings {
  return { githubToken: data.githubToken ? 'saved' : null, githubUser: data.githubUser, pullMode: data.pullMode }
}

export async function setPullMode(m: 'merge' | 'rebase'): Promise<void> {
  data.pullMode = m === 'rebase' ? 'rebase' : 'merge'
  await save()
}
