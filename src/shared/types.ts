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
}
