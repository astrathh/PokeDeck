import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppConfig } from '../shared/types'

export const DEFAULT_CONFIG: AppConfig = {
  gameUrl: '',
  accounts: [],
  layout: 'grid',
  economy: false,
  staggerSec: 8,
  watchdog: {
    enabled: true,
    checkIntervalSec: 30,
    unresponsiveGraceSec: 45,
    memoryLimitMb: 1500,
    disconnectPatterns: []
  },
  updateWatch: {
    enabled: true,
    intervalMin: 5,
    versionUrl: '',
    versionRegex: ''
  },
  extensions: ['hunt-for-pokeidle']
}

/** Configuração persistida em %APPDATA%/deck-multiconta/config.json */
export class ConfigStore {
  private readonly file = join(app.getPath('userData'), 'config.json')
  private data: AppConfig
  private saveTimer: NodeJS.Timeout | null = null

  constructor() {
    this.data = this.load()
  }

  private load(): AppConfig {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<AppConfig>
      return {
        ...DEFAULT_CONFIG,
        ...raw,
        watchdog: { ...DEFAULT_CONFIG.watchdog, ...raw.watchdog },
        updateWatch: { ...DEFAULT_CONFIG.updateWatch, ...raw.updateWatch }
      }
    } catch {
      return structuredClone(DEFAULT_CONFIG)
    }
  }

  get(): AppConfig {
    return this.data
  }

  /** Substitui o objeto inteiro (imutável), então quem guardou o anterior pode comparar. */
  update(patch: Partial<AppConfig>): AppConfig {
    this.data = { ...this.data, ...patch }
    this.scheduleSave()
    return this.data
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), 300)
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2))
      renameSync(tmp, this.file)
    } catch (err) {
      console.error('Falha ao salvar config', err)
    }
  }
}
