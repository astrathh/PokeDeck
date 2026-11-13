import { app } from 'electron'
import { EventEmitter } from 'node:events'
import { autoUpdater } from 'electron-updater'
import type { AppUpdateState } from '../shared/types'
import type { Logger } from './logger'

/** De quanto em quanto tempo procura versão nova nas Releases do GitHub. */
const CHECK_EVERY_MS = 4 * 60 * 60_000
/** Primeira procura depois de abrir (deixa as contas abrirem antes). */
const FIRST_CHECK_MS = 15_000

/**
 * Atualização do próprio PokeDeck (instalado). Procura nas Releases do GitHub (package.json → build.publish),
 * baixa em segundo plano e instala ao reiniciar — pelo botão na interface ou quando o PokeDeck fechar.
 * Em desenvolvimento (`npm run dev`) não faz nada.
 */
export class AppUpdater extends EventEmitter {
  private state: AppUpdateState = { state: app.isPackaged ? 'idle' : 'dev', current: app.getVersion() }
  private timer: NodeJS.Timeout | null = null
  private lastError = ''

  constructor(private readonly log: Logger) {
    super()
  }

  get(): AppUpdateState {
    return this.state
  }

  private set(patch: Partial<AppUpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.state)
  }

  start(): void {
    if (!app.isPackaged) return
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = null

    autoUpdater.on('checking-for-update', () => {
      if (this.state.state !== 'ready') this.set({ state: 'checking', message: undefined })
    })
    autoUpdater.on('update-not-available', () => {
      if (this.state.state !== 'ready') this.set({ state: 'idle', checkedAt: Date.now() })
    })
    autoUpdater.on('update-available', (info) => {
      this.log.info(null, `PokeDeck ${info.version} disponível, baixando…`)
      this.set({ state: 'downloading', version: info.version, percent: 0 })
    })
    autoUpdater.on('download-progress', (p) => this.set({ state: 'downloading', percent: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info) => {
      this.log.info(null, `PokeDeck ${info.version} baixado. Reinicie para atualizar (ou ele instala ao fechar)`)
      this.set({ state: 'ready', version: info.version, percent: 100 })
    })
    autoUpdater.on('error', (err) => {
      const msg = err?.message ?? String(err)
      // Sem internet etc.: avisa uma vez por mensagem, não a cada 4 h.
      if (msg !== this.lastError) this.log.warn(null, `Atualização do PokeDeck falhou: ${msg.split('\n')[0]}`)
      this.lastError = msg
      if (this.state.state !== 'ready') this.set({ state: 'error', message: msg.split('\n')[0] })
    })

    setTimeout(() => void this.check(), FIRST_CHECK_MS)
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async check(): Promise<void> {
    if (!app.isPackaged || this.state.state === 'ready' || this.state.state === 'downloading') return
    try {
      await autoUpdater.checkForUpdates()
    } catch {
      /* o evento 'error' já registrou */
    }
  }

  /** Fecha o PokeDeck, instala a versão baixada e abre de novo. */
  installNow(): void {
    if (this.state.state !== 'ready') return
    this.log.info(null, `Reiniciando para instalar o PokeDeck ${this.state.version}`)
    autoUpdater.quitAndInstall(true, true)
  }
}
