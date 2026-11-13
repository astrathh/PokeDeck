export type AccountStatus = 'loading' | 'ready' | 'reloading' | 'crashed' | 'unresponsive' | 'offline'

export interface AccountConfig {
  id: string
  name: string
  muted: boolean
  enabled: boolean
}

export interface WatchdogConfig {
  enabled: boolean
  /** De quanto em quanto tempo checa as contas */
  checkIntervalSec: number
  /** Quanto tempo uma página pode ficar travada antes de ser reiniciada */
  unresponsiveGraceSec: number
  /** Recarrega a conta se passar desse uso de RAM (0 = desligado) */
  memoryLimitMb: number
  /** Textos que, se aparecerem na página, indicam desconexão */
  disconnectPatterns: string[]
}

export interface UpdateWatchConfig {
  enabled: boolean
  intervalMin: number
  /** URL para checar a versão (vazio = usa a URL do jogo) */
  versionUrl: string
  /** Regex opcional; o grupo 1 (ou o match inteiro) vira a "versão" */
  versionRegex: string
}

/** Automação (resources/deck-auto + main/autoPilot.ts). Vale igual para todas as contas. */
export interface AutoConfig {
  /** Chave geral: desligado, o Deck não chama o script e nada acontece */
  enabled: boolean
  /** Simulação: só registra em Eventos o que faria */
  dryRun: boolean
  /** De quanto em quanto tempo reavalia as hunts (min) */
  intervalMin: number
  /** Contas em que a automação NÃO roda (as demais rodam; conta nova entra ligada) */
  excludedIds: string[]
  potions: {
    enabled: boolean
    /** Deixa só a poção escolhida na lista "Usar Poções" do jogo */
    manageList: boolean
    /** Compra quando o estoque não dá para estas horas… */
    refillBelowHours: number
    /** …e completa até estas horas */
    stockHours: number
    /** Uma compra nunca passa desta % do ouro da conta */
    maxGoldPct: number
  }
  hunts: {
    enabled: boolean
    /** Passar pelo Centro Pokémon antes de ir para a hunt nova (padrão: troca direto) */
    viaCenter: boolean
    /** Tempo mínimo numa hunt antes de trocar por XP/h (min); evita ficar trocando por oscilação da estimativa */
    minStayMin: number
    /** Contas com nível até este valor usam o teto de risco abaixo */
    lowLevel: number
    levelOf: 'trainer' | 'pokemon'
    /** Teto do pior golpe do selvagem, em % do HP máximo, para contas de nível baixo */
    lowLevelMaxHitPct: number
    /** Recusa hunts em que o gasto com poção passa do ouro que a hunt rende */
    requirePositiveGold: boolean
  }
}

export interface AutoStatus {
  state: 'ok' | 'aguardando' | 'erro'
  message: string
  checkedAt: number
  pokemon?: string
  hpMax?: number
  /** Limiar da poção automática do jogo (0–1) */
  limiar?: number
  /** Por que trocou ou não trocou de hunt neste tick */
  huntNote?: string
  /** Versão da automação carregada (hash do auto.js) */
  version?: string
  /** Por que comprou ou não comprou poção neste tick */
  potionNote?: string
  /** name/stock: a melhor em estoque (a que o jogo usa); hours: todas as poções somadas; buy: a que compraria. */
  potion?: {
    name: string
    stock: number
    /** O que a automação usa: o maior entre estimado e medido */
    perHour: number
    hours: number
    buy?: string
    /** Gasto medido nos últimos 30 min (poções/h da que está usando); ausente nos primeiros 5 min na hunt */
    measured?: number
    /** Estimativa do /hunt (poções/h) */
    estimated?: number
  }
  hunt?: { name: string; xpH: number; hitPct: number; safe: boolean }
  best?: { name: string; xpH: number; hitPct: number }
}

/** Ajustes para gastar menos RAM/CPU/GPU. */
export interface PerformanceConfig {
  /** Bloqueia rastreadores de terceiros nas contas (Facebook Pixel, Google Analytics/Tag Manager) */
  blockTrackers: boolean
}

export type LayoutMode = 'grid' | 'columns' | 'focus'

export interface AppConfig {
  gameUrl: string
  accounts: AccountConfig[]
  layout: LayoutMode
  economy: boolean
  /** Intervalo entre recarregamentos em fila, para não recarregar tudo junto */
  staggerSec: number
  watchdog: WatchdogConfig
  updateWatch: UpdateWatchConfig
  /** Extensões da addons.mozilla.org (slug ou link), carregadas em todas as contas */
  extensions: string[]
  auto: AutoConfig
  performance: PerformanceConfig
}

export interface AccountRuntime {
  id: string
  status: AccountStatus
  title: string
  url: string
  detached: boolean
  memoryMb: number
  cpu: number
  lastEvent: string | null
  /** Quando a conta ficou online pela última vez */
  since: number
  auto: AutoStatus | null
}

export interface MetricsSample {
  ts: number
  accounts: Record<string, { memoryMb: number; cpu: number }>
  totalMemoryMb: number
  totalCpu: number
}

export interface LogEntry {
  ts: number
  level: 'info' | 'warn' | 'error'
  accountId: string | null
  message: string
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type AccountAction = 'reload' | 'hardReload' | 'home' | 'detach' | 'attach' | 'devtools' | 'logout'

export type Unsubscribe = () => void

/** Atualização do próprio Deck (instalado), pelas Releases do GitHub. */
export interface AppUpdateState {
  /** dev = rodando com npm run dev (não atualiza) */
  state: 'dev' | 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
  /** Versão instalada */
  current: string
  /** Versão nova (baixando ou pronta) */
  version?: string
  percent?: number
  message?: string
  checkedAt?: number
}

export interface DeckApi {
  getConfig(): Promise<AppConfig>
  updateConfig(patch: Partial<AppConfig>): Promise<AppConfig>
  addAccount(name?: string): Promise<AppConfig>
  removeAccount(id: string): Promise<AppConfig>
  action(id: string, action: AccountAction): Promise<void>
  reloadAll(): Promise<void>
  checkUpdateNow(): Promise<void>
  getRuntime(): Promise<AccountRuntime[]>
  getLogs(): Promise<LogEntry[]>
  setBounds(rects: Record<string, Rect | null>): void
  setOverlay(open: boolean): void
  onConfig(cb: (c: AppConfig) => void): Unsubscribe
  onRuntime(cb: (r: AccountRuntime[]) => void): Unsubscribe
  onMetrics(cb: (s: MetricsSample) => void): Unsubscribe
  onLog(cb: (e: LogEntry) => void): Unsubscribe
  onFocused(cb: (id: string) => void): Unsubscribe
  getAppUpdate(): Promise<AppUpdateState>
  checkAppUpdate(): Promise<void>
  installAppUpdate(): Promise<void>
  onAppUpdate(cb: (s: AppUpdateState) => void): Unsubscribe
}
