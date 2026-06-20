// ── API Client ─────────────────────────────────────────────────────

import { logger } from './logger'

const BASE = '/api'
const DEFAULT_TIMEOUT = 30_000  // 30 seconds

export async function request<T>(path: string, options?: RequestInit & { timeout?: number }): Promise<T> {
  const { timeout = DEFAULT_TIMEOUT, ...fetchOptions } = options || {}
  const method = fetchOptions.method || 'GET'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  const start = performance.now()

  try {
    const res = await fetch(`${BASE}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...fetchOptions.headers },
    })
    const duration = Math.round(performance.now() - start)
    if (!res.ok) {
      const body = await res.text()
      logger.apiError(method, path, { status: res.status, body })
      throw new Error(body || `${res.status} ${res.statusText}`)
    }
    logger.api(method, path, res.status, duration)
    const text = await res.text()
    if (!text) return undefined as T
    return JSON.parse(text) as T
  } catch (err) {
    const duration = Math.round(performance.now() - start)
    if (err instanceof TypeError && err.message === 'Failed to fetch') {
      logger.apiError(method, path, { reason: 'network-error', durationMs: duration })
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
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
