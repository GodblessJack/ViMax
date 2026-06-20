// ── API Client ─────────────────────────────────────────────────────

const BASE = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(body || `${res.status} ${res.statusText}`)
  }
  return res.json()
}

// ── Sessions ───────────────────────────────────────────────────────

import type { SessionSummary, SessionDetail, StyleOption, WorkItem } from './types'

export async function listSessions(params?: {
  search?: string
  stage?: string
  limit?: number
  offset?: number
}): Promise<{ items: SessionSummary[]; total: number }> {
  const qs = new URLSearchParams()
  if (params?.search) qs.set('search', params.search)
  if (params?.stage) qs.set('stage', params.stage)
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.offset) qs.set('offset', String(params.offset))
  return request(`/sessions?${qs}`)
}

export async function getSession(id: string): Promise<SessionDetail> {
  return request(`/sessions/${id}`)
}

export async function createSession(body: {
  idea: string
  user_requirement: string
  style: string
}): Promise<SessionDetail> {
  return request('/sessions', { method: 'POST', body: JSON.stringify(body) })
}

export async function deleteSession(id: string): Promise<void> {
  await request(`/sessions/${id}`, { method: 'DELETE' })
}

// ── Pipeline ───────────────────────────────────────────────────────

export async function startPlanning(body: {
  session_id?: string
  idea: string
  user_requirement: string
  style: string
}): Promise<{ session_id: string; status: string }> {
  return request('/pipeline/plan', { method: 'POST', body: JSON.stringify(body) })
}

export async function startRendering(body: {
  session_id: string
}): Promise<{ session_id: string; status: string }> {
  return request('/pipeline/render', { method: 'POST', body: JSON.stringify(body) })
}

export async function cancelPipeline(sessionId: string): Promise<void> {
  await request(`/pipeline/cancel/${sessionId}`, { method: 'POST' })
}

// ── Works ──────────────────────────────────────────────────────────

export async function listWorks(params?: {
  search?: string
  limit?: number
  offset?: number
}): Promise<{ items: WorkItem[]; total: number }> {
  const qs = new URLSearchParams()
  if (params?.search) qs.set('search', params.search)
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.offset) qs.set('offset', String(params.offset))
  return request(`/works?${qs}`)
}

export function getWorkDownloadUrl(sessionId: string): string {
  return `${BASE}/works/${sessionId}/download`
}

// ── Files ──────────────────────────────────────────────────────────

export function getFileUrl(sessionId: string, filePath: string): string {
  return `${BASE}/files/${sessionId}/${filePath}`
}

// ── Styles ─────────────────────────────────────────────────────────

export async function listStyles(): Promise<StyleOption[]> {
  return request('/styles')
}
