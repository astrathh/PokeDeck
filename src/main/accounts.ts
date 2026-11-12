import { BrowserWindow, session, shell, WebContentsView, type WebContents } from 'electron'
import { EventEmitter } from 'node:events'
import type {
  AccountAction,
  AccountConfig,
  AccountRuntime,
  AccountStatus,
  AppConfig,
  Rect
} from '../shared/types'
import type { ConfigStore } from './store'
import type { Logger } from './logger'
import type { ExtensionManager } from './extensions'

/** Tempo mínimo entre dois recarregamentos automáticos da mesma conta (evita loop). */
const AUTO_RELOAD_COOLDOWN_MS = 2 * 60_000

/** Popups desses domínios abrem dentro do app (na mesma sessão da conta), p/ login social funcionar. */
const AUTH_HOSTS = [/(^|\.)google\.com$/, /(^|\.)discord\.com$/, /(^|\.)facebook\.com$/, /(^|\.)twitch\.tv$/, /(^|\.)apple\.com$/]

const BG = '#0d0f14'

export const partitionFor = (id: string): string => `persist:acc-${id}`

interface Slot {
  id: string
  view: WebContentsView
  status: AccountStatus
  title: string
  url: string
  since: number
  detachedWindow: BrowserWindow | null
  unresponsiveSince: number | null
  failCount: number
  lastAutoReloadAt: number
  retryTimer: NodeJS.Timeout | null
  memoryMb: number
  cpu: number
  lastEvent: string | null
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/**
 * Gerencia uma WebContentsView por conta, cada uma numa partição persistente
 * (cookies/localStorage separados), mais o watchdog e a fila de recarregamento.
 *
 * Eventos: 'runtime' (AccountRuntime[]), 'focused' (id).
 */
export class AccountManager extends EventEmitter {
  private slots = new Map<string, Slot>()
  private bounds: Record<string, Rect | null> = {}
  private overlay = false
  private queue: { id: string; reason: string }[] = []
  private queueTimer: NodeJS.Timeout | null = null
  private watchdogTimer: NodeJS.Timeout | null = null
  private emitTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly win: BrowserWindow,
    private readonly store: ConfigStore,
    private readonly log: Logger,
    private readonly extensions: ExtensionManager
  ) {
    super()
  }

  private get cfg(): AppConfig {
    return this.store.get()
  }

  private account(id: string): AccountConfig | undefined {
    return this.cfg.accounts.find((a) => a.id === id)
  }

  private alive(slot: Slot): boolean {
    return this.slots.get(slot.id) === slot && !slot.view.webContents.isDestroyed()
  }

  // ---------------------------------------------------------------- ciclo de vida

  /** Cria/destroi views para bater com a config (contas ativas). */
  sync(): void {
    const cfg = this.cfg
    const wanted = new Set(cfg.gameUrl ? cfg.accounts.filter((a) => a.enabled).map((a) => a.id) : [])
    for (const id of [...this.slots.keys()]) if (!wanted.has(id)) this.destroy(id)
    for (const acc of cfg.accounts) if (wanted.has(acc.id) && !this.slots.has(acc.id)) this.create(acc)
    this.applyLayout()
    this.emitRuntime()
  }

  private create(acc: AccountConfig): void {
    const partition = partitionFor(acc.id)
    const ses = session.fromPartition(partition)
    // Não mexer no user agent. Tirar o "Electron/x" para fingir ser Chrome deixa o UA
    // contraditório com o resto do navegador, e o Turnstile da Cloudflare reprova
    // (testado: UA limpo falhou 3/3, UA original passou 3/3).

    const view = new WebContentsView({
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // O jogo continua rodando em velocidade normal mesmo com a view escondida.
        backgroundThrottling: false
      }
    })
    view.setBackgroundColor(BG)
    view.setVisible(false)
    this.win.contentView.addChildView(view)

    const slot: Slot = {
      id: acc.id,
      view,
      status: 'loading',
      title: '',
      url: '',
      since: Date.now(),
      detachedWindow: null,
      unresponsiveSince: null,
      failCount: 0,
      lastAutoReloadAt: 0,
      retryTimer: null,
      memoryMb: 0,
      cpu: 0,
      lastEvent: null
    }
    this.slots.set(acc.id, slot)
    this.wire(slot)
    view.webContents.setAudioMuted(acc.muted)
    this.log.info(acc.id, `Abrindo ${acc.name}`)
    // Content scripts só entram se a extensão já estiver na sessão quando a página abre.
    void this.extensions.attach(ses).finally(() => this.load(slot))
  }

  private destroy(id: string): void {
    const slot = this.slots.get(id)
    if (!slot) return
    if (slot.retryTimer) clearTimeout(slot.retryTimer)
    this.slots.delete(id)
    this.extensions.detach(slot.view.webContents.session)
    this.queue = this.queue.filter((q) => q.id !== id)

    const w = slot.detachedWindow
    if (w && !w.isDestroyed()) {
      w.removeAllListeners('close')
      w.contentView.removeChildView(slot.view)
      w.destroy()
    } else if (!this.win.isDestroyed()) {
      this.win.contentView.removeChildView(slot.view)
    }
    if (!slot.view.webContents.isDestroyed()) slot.view.webContents.close()
  }

  dispose(): void {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer)
    if (this.queueTimer) clearTimeout(this.queueTimer)
    if (this.emitTimer) clearTimeout(this.emitTimer)
    for (const slot of this.slots.values()) {
      if (slot.retryTimer) clearTimeout(slot.retryTimer)
      const w = slot.detachedWindow
      if (w && !w.isDestroyed()) {
        w.removeAllListeners('close')
        w.destroy()
      }
    }
    this.slots.clear()
  }

  private load(slot: Slot): void {
    if (!this.alive(slot)) return
    slot.view.webContents.loadURL(this.cfg.gameUrl).catch(() => {
      /* did-fail-load cuida do erro */
    })
  }

  private wire(slot: Slot): void {
    const wc = slot.view.webContents
    const id = slot.id

    wc.on('did-start-loading', () => {
      if (!this.alive(slot)) return
      this.setStatus(slot, slot.status === 'reloading' ? 'reloading' : 'loading')
    })

    wc.on('did-finish-load', () => {
      if (!this.alive(slot)) return
      slot.failCount = 0
      slot.unresponsiveSince = null
      slot.url = wc.getURL()
      this.setStatus(slot, 'ready', null)
    })

    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      // -3 = ERR_ABORTED (navegação substituída por outra), não é falha de verdade
      if (!this.alive(slot) || !isMainFrame || code === -3) return
      slot.failCount++
      const delay = Math.min(60, 5 * 2 ** (slot.failCount - 1))
      this.setStatus(slot, 'offline', `Falha ao carregar (${desc}). Nova tentativa em ${delay}s`)
      this.log.warn(id, `Falha ao carregar ${url}: ${desc} (${code}). Tentando de novo em ${delay}s`)
      this.scheduleRetry(slot, delay * 1000)
    })

    wc.on('render-process-gone', (_e, details) => {
      if (!this.alive(slot) || details.reason === 'clean-exit') return
      slot.unresponsiveSince = null
      this.setStatus(slot, 'crashed', `Processo caiu (${details.reason})`)
      this.log.error(id, `Processo da página caiu (${details.reason}). Recarregando em 3s`)
      this.scheduleRetry(slot, 3000)
    })

    wc.on('unresponsive', () => {
      if (!this.alive(slot)) return
      slot.unresponsiveSince = Date.now()
      this.setStatus(slot, 'unresponsive', 'Página sem resposta')
      this.log.warn(id, 'Página travou (sem resposta)')
    })

    wc.on('responsive', () => {
      if (!this.alive(slot)) return
      if (slot.unresponsiveSince) this.log.info(id, 'Página voltou a responder')
      slot.unresponsiveSince = null
      // Se travou no meio de um carregamento, ainda não está pronta: did-finish-load marca 'ready'.
      this.setStatus(slot, wc.isLoading() ? 'loading' : 'ready', null)
    })

    wc.on('page-title-updated', (_e, title) => {
      slot.title = title
      this.emitRuntime()
    })

    wc.on('did-navigate', (_e, url) => {
      slot.url = url
      this.emitRuntime()
    })

    // Clicar dentro do jogo seleciona a conta na UI (o evento 'focus' também dispara em reload, por isso não serve).
    wc.on('input-event', (_e, input) => {
      if (input.type === 'mouseDown') this.emit('focused', id)
    })

    wc.setWindowOpenHandler(({ url }) => this.handlePopup(url))
  }

  private handlePopup(url: string): Electron.WindowOpenHandlerResponse {
    const host = safeHost(url)
    if (!host) return { action: 'deny' }
    const gameHost = safeHost(this.cfg.gameUrl)
    const sameSite = gameHost !== '' && (host === gameHost || host.endsWith(`.${gameHost}`))
    if (sameSite || AUTH_HOSTS.some((r) => r.test(host))) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 900, height: 760, autoHideMenuBar: true, backgroundColor: BG }
      }
    }
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  }

  private scheduleRetry(slot: Slot, ms: number): void {
    if (slot.retryTimer) clearTimeout(slot.retryTimer)
    slot.retryTimer = setTimeout(() => {
      slot.retryTimer = null
      if (!this.alive(slot)) return
      this.setStatus(slot, 'reloading')
      this.load(slot)
    }, ms)
  }

  private setStatus(slot: Slot, status: AccountStatus, event?: string | null): void {
    if (status === 'ready' && slot.status !== 'ready') slot.since = Date.now()
    slot.status = status
    if (event !== undefined) slot.lastEvent = event
    this.emitRuntime()
  }

  // ---------------------------------------------------------------- layout

  /** Retângulos vêm da UI (medidos no DOM). null = esconder. */
  setBounds(rects: Record<string, Rect | null>): void {
    this.bounds = rects
    this.applyLayout()
  }

  /** Enquanto um modal está aberto na UI, as views ficam escondidas (elas ficam por cima do HTML). */
  setOverlay(open: boolean): void {
    this.overlay = open
    this.applyLayout()
  }

  private applyLayout(): void {
    if (this.win.isDestroyed()) return
    for (const [id, slot] of this.slots) {
      if (slot.detachedWindow) continue
      const r = this.overlay ? null : this.bounds[id]
      if (r && r.width > 1 && r.height > 1) {
        slot.view.setBounds({
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.width),
          height: Math.round(r.height)
        })
        slot.view.setVisible(true)
      } else {
        slot.view.setVisible(false)
      }
    }
  }

  private detach(slot: Slot): void {
    if (slot.detachedWindow) {
      slot.detachedWindow.focus()
      return
    }
    const name = this.account(slot.id)?.name ?? 'Conta'
    this.win.contentView.removeChildView(slot.view)

    const w = new BrowserWindow({
      width: 1280,
      height: 820,
      title: name,
      backgroundColor: BG,
      autoHideMenuBar: true
    })
    slot.detachedWindow = w
    w.contentView.addChildView(slot.view)
    const fit = (): void => {
      const [width, height] = w.getContentSize()
      slot.view.setBounds({ x: 0, y: 0, width, height })
    }
    fit()
    slot.view.setVisible(true)
    w.on('resize', fit)
    w.on('close', () => {
      // Tira a view antes da janela morrer, senão ela é destruída junto.
      w.contentView.removeChildView(slot.view)
      slot.detachedWindow = null
      if (this.slots.get(slot.id) === slot && !this.win.isDestroyed()) {
        this.win.contentView.addChildView(slot.view)
        slot.view.setVisible(false)
      }
      this.applyLayout()
      this.emitRuntime()
    })
    this.log.info(slot.id, 'Conta destacada em janela própria')
    this.applyLayout()
    this.emitRuntime()
  }

  // ---------------------------------------------------------------- ações

  async action(id: string, action: AccountAction): Promise<void> {
    const slot = this.slots.get(id)
    if (!slot || !this.alive(slot)) return
    const wc = slot.view.webContents
    switch (action) {
      case 'reload':
        this.log.info(id, 'Recarregada manualmente')
        wc.reload()
        break
      case 'hardReload':
        this.log.info(id, 'Recarregada sem cache')
        wc.reloadIgnoringCache()
        break
      case 'home':
        this.load(slot)
        break
      case 'detach':
        this.detach(slot)
        break
      case 'attach':
        slot.detachedWindow?.close()
        break
      case 'devtools':
        wc.openDevTools({ mode: 'detach' })
        break
      case 'logout':
        await session.fromPartition(partitionFor(id)).clearStorageData()
        this.log.info(id, 'Sessão apagada (logout)')
        this.load(slot)
        break
    }
  }

  /** Coloca a conta na fila de recarregamento. Contas são recarregadas uma por vez, com intervalo. */
  queueReload(id: string, reason: string, auto = true): void {
    const slot = this.slots.get(id)
    if (!slot) return
    if (auto && Date.now() - slot.lastAutoReloadAt < AUTO_RELOAD_COOLDOWN_MS) return
    if (this.queue.some((q) => q.id === id)) return
    if (auto) slot.lastAutoReloadAt = Date.now()
    this.queue.push({ id, reason })
    this.pump()
  }

  reloadAll(reason: string): void {
    for (const id of this.slots.keys()) this.queueReload(id, reason, false)
  }

  private pump(): void {
    if (this.queueTimer) return
    const next = (): void => {
      const item = this.queue.shift()
      if (!item) {
        this.queueTimer = null
        return
      }
      const slot = this.slots.get(item.id)
      if (slot && this.alive(slot)) {
        this.log.info(item.id, `Recarregando: ${item.reason}`)
        this.setStatus(slot, 'reloading', item.reason)
        this.load(slot)
      }
      this.queueTimer = setTimeout(next, Math.max(0, this.cfg.staggerSec) * 1000)
    }
    next()
  }

  onConfigChanged(prev: AppConfig, next: AppConfig): void {
    for (const acc of next.accounts) {
      const slot = this.slots.get(acc.id)
      if (slot && this.alive(slot)) slot.view.webContents.setAudioMuted(acc.muted)
      if (slot?.detachedWindow && !slot.detachedWindow.isDestroyed()) slot.detachedWindow.setTitle(acc.name)
    }
    if (prev.gameUrl !== next.gameUrl && next.gameUrl) {
      for (const slot of this.slots.values()) this.load(slot)
    }
    this.sync()
    if (prev.watchdog !== next.watchdog) this.restartWatchdog()
  }

  // ---------------------------------------------------------------- watchdog

  restartWatchdog(): void {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer)
    this.watchdogTimer = null
    const w = this.cfg.watchdog
    if (!w.enabled) return
    this.watchdogTimer = setInterval(() => void this.watchdogTick(), Math.max(5, w.checkIntervalSec) * 1000)
  }

  private async watchdogTick(): Promise<void> {
    const w = this.cfg.watchdog
    const now = Date.now()
    for (const slot of [...this.slots.values()]) {
      if (!this.alive(slot)) continue
      const wc = slot.view.webContents

      // 1) Página travada há tempo demais → derruba o processo; o handler de crash recarrega.
      if (slot.unresponsiveSince && now - slot.unresponsiveSince > w.unresponsiveGraceSec * 1000) {
        this.log.warn(slot.id, `Travada há mais de ${w.unresponsiveGraceSec}s, reiniciando a página`)
        slot.unresponsiveSince = null
        wc.forcefullyCrashRenderer()
        continue
      }

      // 2) Memória acima do limite → recarrega (libera o que vazou).
      if (w.memoryLimitMb > 0 && slot.memoryMb > w.memoryLimitMb) {
        this.queueReload(
          slot.id,
          `memória em ${Math.round(slot.memoryMb)} MB (limite ${w.memoryLimitMb} MB)`
        )
        continue
      }

      // 3) Texto de desconexão na tela → recarrega.
      const patterns = w.disconnectPatterns.map((p) => p.trim().toLowerCase()).filter(Boolean)
      if (slot.status === 'ready' && patterns.length) {
        const text = await this.pageText(wc)
        const hit = text ? patterns.find((p) => text.includes(p)) : undefined
        if (hit) this.queueReload(slot.id, `texto de desconexão encontrado: "${hit}"`)
      }
    }
  }

  private async pageText(wc: WebContents): Promise<string | null> {
    const js = `(() => { const b = document.body; return b ? b.innerText.slice(0, 300000).toLowerCase() : '' })()`
    try {
      return await Promise.race([
        wc.executeJavaScript(js, false) as Promise<string>,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000))
      ])
    } catch {
      return null
    }
  }

  // ---------------------------------------------------------------- métricas / estado

  pids(): { id: string; pid: number }[] {
    return [...this.slots.values()].map((s) => ({
      id: s.id,
      pid: s.view.webContents.isDestroyed() ? 0 : s.view.webContents.getOSProcessId()
    }))
  }

  applyMetrics(values: Record<string, { memoryMb: number; cpu: number }>): void {
    for (const [id, v] of Object.entries(values)) {
      const slot = this.slots.get(id)
      if (!slot) continue
      slot.memoryMb = v.memoryMb
      slot.cpu = v.cpu
    }
    this.emitRuntime()
  }

  runtime(): AccountRuntime[] {
    return [...this.slots.values()].map((s) => ({
      id: s.id,
      status: s.status,
      title: s.title,
      url: s.url,
      detached: s.detachedWindow !== null,
      memoryMb: s.memoryMb,
      cpu: s.cpu,
      lastEvent: s.lastEvent,
      since: s.since
    }))
  }

  private emitRuntime(): void {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      this.emit('runtime', this.runtime())
    }, 100)
  }
}
