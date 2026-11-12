import { EventEmitter } from 'node:events'
import type { LogEntry } from '../shared/types'

const MAX_ENTRIES = 1000

export class Logger extends EventEmitter {
  private entries: LogEntry[] = []

  all(): LogEntry[] {
    return this.entries
  }

  private push(level: LogEntry['level'], accountId: string | null, message: string): void {
    const entry: LogEntry = { ts: Date.now(), level, accountId, message }
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES)
    console.log(`[${level}]${accountId ? ` [${accountId}]` : ''} ${message}`)
    this.emit('entry', entry)
  }

  info(accountId: string | null, message: string): void {
    this.push('info', accountId, message)
  }

  warn(accountId: string | null, message: string): void {
    this.push('warn', accountId, message)
  }

  error(accountId: string | null, message: string): void {
    this.push('error', accountId, message)
  }
}
