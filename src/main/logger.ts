import { EventEmitter } from 'node:events'
import { appendFile, appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { LogEntry } from '../shared/types'

const MAX_ENTRIES = 1000
/** Quantos dias de Eventos ficam no disco. */
const KEEP_DAYS = 14
const FLUSH_MS = 1000

const pad = (n: number): string => String(n).padStart(2, '0')
const day = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const clock = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

/**
 * Eventos do Deck: ficam na memória (para a interface) e num arquivo por dia em
 * <pasta>/eventos-AAAA-MM-DD.log, apagando os com mais de 14 dias.
 */
export class Logger extends EventEmitter {
  private entries: LogEntry[] = []
  private dir: string | null = null
  private nameOf: (id: string) => string = (id) => id
  private buffer: { file: string; text: string }[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private lastCleanupDay = ''

  /** Liga a gravação em disco. `nameOf` troca o id da conta pelo nome nas linhas do arquivo. */
  toFiles(dir: string, nameOf: (id: string) => string): void {
    this.dir = dir
    this.nameOf = nameOf
    try {
      mkdirSync(dir, { recursive: true })
    } catch (err) {
      console.error('Não consegui criar a pasta de Eventos', err)
      this.dir = null
    }
  }

  all(): LogEntry[] {
    return this.entries
  }

  private push(level: LogEntry['level'], accountId: string | null, message: string): void {
    const entry: LogEntry = { ts: Date.now(), level, accountId, message }
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES)
    console.log(`[${level}]${accountId ? ` [${accountId}]` : ''} ${message}`)
    this.write(entry)
    this.emit('entry', entry)
  }

  private write(e: LogEntry): void {
    if (!this.dir) return
    const d = new Date(e.ts)
    const who = e.accountId ? ` [${this.nameOf(e.accountId)}]` : ''
    const file = join(this.dir, `eventos-${day(d)}.log`)
    this.buffer.push({ file, text: `${clock(d)} ${e.level.toUpperCase().padEnd(5)}${who} ${e.message}\n` })
    this.flushTimer ??= setTimeout(() => this.flush(false), FLUSH_MS)
  }

  /** Grava o que está pendente. `sync` no fechamento do app, para não perder as últimas linhas. */
  flush(sync = true): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    const porArquivo = new Map<string, string>()
    for (const b of this.buffer.splice(0)) porArquivo.set(b.file, (porArquivo.get(b.file) ?? '') + b.text)
    for (const [file, text] of porArquivo) {
      if (sync) {
        try {
          appendFileSync(file, text)
        } catch {
          /* disco cheio / sem permissão: segue só na memória */
        }
      } else {
        appendFile(file, text, () => undefined)
      }
    }
    this.cleanup()
  }

  /** Apaga arquivos com mais de KEEP_DAYS dias (uma vez por dia). */
  private cleanup(): void {
    const hoje = day(new Date())
    if (!this.dir || this.lastCleanupDay === hoje) return
    this.lastCleanupDay = hoje
    const limite = day(new Date(Date.now() - KEEP_DAYS * 86_400_000))
    try {
      for (const f of readdirSync(this.dir)) {
        const m = f.match(/^eventos-(\d{4}-\d{2}-\d{2})\.log$/)
        if (m && m[1] < limite) rmSync(join(this.dir, f), { force: true })
      }
    } catch {
      /* tenta amanhã */
    }
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
