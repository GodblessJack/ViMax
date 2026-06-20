// ── Frontend Logger — structured client-side logging ─────────────────────
// Wraps `console` with consistent formatting and level control.
// In production builds (import.meta.env.PROD) `debug`-level logs are
// suppressed automatically.  To send logs to a remote service, extend
// `_writeRecord` without touching call sites.

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogRecord {
  ts: string       // ISO timestamp
  level: LogLevel
  channel: string  // e.g. "api", "ws", "user", "error"
  message: string
  detail?: unknown
}

const _formatTs = (d: Date): string =>
  d.toISOString().replace('T', ' ').slice(0, 23) // "2026-06-20 14:35:02.123"

function _writeRecord(rec: LogRecord): void {
  const prefix = `${rec.ts} [${rec.level.toUpperCase().padEnd(5)}] ${rec.channel} |`
  const args: unknown[] = [prefix, rec.message]
  if (rec.detail !== undefined) args.push(rec.detail)

  switch (rec.level) {
    case 'error':
      console.error(...args)
      break
    case 'warn':
      console.warn(...args)
      break
    case 'info':
      console.info(...args)
      break
    default:
      if (!import.meta.env.PROD) console.debug(...args)
  }

  // ── Extension point: send `rec` to a remote collector ──────────────
  // e.g. fetch('/api/logs', { method: 'POST', body: JSON.stringify(rec) })
}

function _log(level: LogLevel, channel: string, message: string, detail?: unknown): void {
  _writeRecord({ ts: _formatTs(new Date()), level, channel, message, detail })
}

// ── Public API ───────────────────────────────────────────────────────────

/** HTTP request lifecycle */
export const logger = {
  /** Successful API call */
  api: (method: string, url: string, status: number, durationMs?: number) => {
    const dur = durationMs !== undefined ? ` (${durationMs}ms)` : ''
    _log('info', 'api', `${method} ${url} → ${status}${dur}`)
  },

  /** Failed API call */
  apiError: (method: string, url: string, err: unknown) => {
    _log('error', 'api', `${method} ${url} failed`, err)
  },

  /** WebSocket event received / sent */
  ws: (direction: 'rx' | 'tx', event: string, detail?: unknown) => {
    _log('debug', 'ws', `${direction === 'rx' ? '←' : '→'} ${event}`, detail)
  },

  /** User-initiated action (button click, navigation, form submit …) */
  userAction: (action: string, detail?: unknown) => {
    _log('info', 'user', action, detail)
  },

  /** Expected-but-notable state transitions */
  state: (message: string) => {
    _log('info', 'state', message)
  },

  /** Caught error with recovery context */
  error: (context: string, err: unknown) => {
    _log('error', 'error', context, err)
  },

  /** Unexpected situation that doesn't break the app */
  warn: (context: string, detail?: unknown) => {
    _log('warn', 'warn', context, detail)
  },

  /** Low-level debug (stripped in prod builds) */
  debug: (context: string, detail?: unknown) => {
    _log('debug', 'debug', context, detail)
  },
}
