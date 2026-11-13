import type { AutoStatus } from '../shared/types'
import type { AccountManager } from './accounts'
import type { ConfigStore } from './store'
import type { Logger } from './logger'

/** De quanto em quanto tempo o Deck chama o script de cada conta. A cadência de troca de hunt fica no script. */
const TICK_MS = 60_000
const TICK_TIMEOUT_MS = 15_000
/** Consulta rápida do que a missão de troca de hunt (que roda na página, passo de 1s) fez. */
const DRAIN_MS = 3_000

type Acao = { nivel: 'info' | 'warn'; msg: string }

interface TickResult {
  status: AutoStatus
  acoes: Acao[]
}

/**
 * Dispara a automação (resources/deck-auto/auto.js) em cada conta pronta. O script só age dentro
 * do tick, então desligar aqui para tudo na hora.
 */
export class AutoPilot {
  private timer: NodeJS.Timeout | null = null
  private drainTimer: NodeJS.Timeout | null = null
  private running = false
  /** Último estado "não ok" de cada conta, para avisar em Eventos só quando muda. */
  private lastProblem = new Map<string, string>()

  constructor(
    private readonly store: ConfigStore,
    private readonly log: Logger,
    private readonly manager: AccountManager,
    /** Versão da automação carregada nas contas (aparece no painel) */
    private readonly version: () => string = () => ''
  ) {}

  /** Contas prontas em que a automação está ligada (Configurações → contas com automação). */
  private contents(): { id: string; wc: Electron.WebContents }[] {
    const fora = new Set(this.store.get().auto.excludedIds ?? [])
    return this.manager.readyContents().filter((c) => !fora.has(c.id))
  }

  restart(): void {
    this.stop()
    const c = this.store.get().auto
    if (!c.enabled) {
      this.manager.clearAutoStatus()
      return
    }
    const fora = new Set(c.excludedIds ?? [])
    const contas = this.store.get().accounts.filter((a) => !fora.has(a.id))
    for (const id of fora) this.manager.setAutoStatus(id, null)
    const em = fora.size ? ` em: ${contas.map((a) => a.name).join(', ') || 'nenhuma conta'}` : ''
    this.log.info(null, `${c.dryRun ? 'Automação ligada em modo simulação' : 'Automação ligada'}${em}`)
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.drainTimer = setInterval(() => void this.drain(), DRAIN_MS)
    // Primeira rodada logo, mas dá tempo das contas recém-abertas conectarem.
    setTimeout(() => void this.tick(), 5_000)
  }

  stop(): void {
    const wasRunning = !!this.timer
    if (this.timer) clearInterval(this.timer)
    if (this.drainTimer) clearInterval(this.drainTimer)
    this.timer = null
    this.drainTimer = null
    // Cancela trocas de hunt em andamento nas páginas (elas rodam sozinhas a cada 1s).
    if (wasRunning) {
      for (const { id, wc } of this.manager.readyContents()) {
        void (wc.executeJavaScript('window.__deckAuto?.parar ? window.__deckAuto.parar() : []', false) as Promise<Acao[]>)
          .then((acoes) => this.logAcoes(id, acoes))
          .catch(() => undefined)
      }
    }
  }

  private logAcoes(id: string, acoes: Acao[] | null | undefined): void {
    for (const a of acoes ?? []) {
      if (a.nivel === 'warn') this.log.warn(id, `Auto: ${a.msg}`)
      else this.log.info(id, `Auto: ${a.msg}`)
    }
  }

  /** Leva para Eventos, sem esperar o próximo tick, o que a missão de troca fez. */
  private async drain(): Promise<void> {
    for (const { id, wc } of this.contents()) {
      try {
        const r = (await Promise.race([
          wc.executeJavaScript('window.__deckAuto?.drenar ? window.__deckAuto.drenar() : null', false),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), DRAIN_MS))
        ])) as { acoes: Acao[] } | null
        this.logAcoes(id, r?.acoes)
      } catch {
        /* página recarregando: o tick trata */
      }
    }
  }

  /**
   * Atualiza o status da conta e avisa em Eventos quando ela para de rodar (erro) ou fica esperando
   * algo (sem conexão, sem pokémon…) — uma vez por mudança, não a cada tick — e quando volta.
   */
  private report(id: string, status: AutoStatus): void {
    const antes = this.lastProblem.get(id)
    if (status.state === 'ok') {
      if (antes) this.log.info(id, 'Auto: voltou a rodar')
      this.lastProblem.delete(id)
    } else if (antes !== status.message) {
      if (status.state === 'erro') this.log.warn(id, `Auto parada: ${status.message}`)
      else this.log.info(id, `Auto esperando: ${status.message}`)
      this.lastProblem.set(id, status.message)
    }
    this.manager.setAutoStatus(id, { ...status, version: this.version() })
  }

  private async tick(): Promise<void> {
    if (this.running || !this.timer) return
    this.running = true
    try {
      const cfg = this.store.get().auto
      const js = `window.__deckAuto ? window.__deckAuto.tick(${JSON.stringify(cfg)}) : null`
      for (const { id, wc } of this.contents()) {
        // Desligaram no meio da rodada: não chama mais ninguém.
        if (!this.timer || !this.store.get().auto.enabled) break
        let res: TickResult | null
        try {
          res = await Promise.race([
            wc.executeJavaScript(js, false) as Promise<TickResult | null>,
            new Promise<null>((_, reject) => setTimeout(() => reject(new Error('sem resposta da página')), TICK_TIMEOUT_MS))
          ])
        } catch (err) {
          this.report(id, { state: 'erro', message: (err as Error).message, checkedAt: Date.now() })
          continue
        }
        if (!res) {
          this.report(id, {
            state: 'erro',
            message: 'Script de automação não está na página. Recarregue a conta',
            checkedAt: Date.now()
          })
          continue
        }
        this.logAcoes(id, res.acoes)
        this.report(id, res.status)
      }
    } finally {
      this.running = false
    }
  }
}
