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
  extensions: ['hunt-for-pokeidle'],
  auto: {
    enabled: false,
    dryRun: true,
    intervalMin: 5,
    excludedIds: [],
    potions: {
      enabled: true,
      manageList: true,
      refillBelowHours: 1,
      stockHours: 2,
      maxGoldPct: 20
    },
    hunts: {
      enabled: true,
      minStayMin: 15,
      viaCenter: false,
      lowLevel: 200,
      levelOf: 'trainer',
      lowLevelMaxHitPct: 30,
      requirePositiveGold: false
    }
  }
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
        updateWatch: { ...DEFAULT_CONFIG.updateWatch, ...raw.updateWatch },
        auto: {
          ...DEFAULT_CONFIG.auto,
          ...raw.auto,
          potions: { ...DEFAULT_CONFIG.auto.potions, ...raw.auto?.potions },
          hunts: { ...DEFAULT_CONFIG.auto.hunts, ...raw.auto?.hunts }
        }
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
