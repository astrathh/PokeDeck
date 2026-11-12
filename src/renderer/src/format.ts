import type { AccountConfig, AccountRuntime, AccountStatus } from '../../shared/types'

export type DisplayStatus = AccountStatus | 'paused'

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  loading: 'carregando',
  ready: 'online',
  reloading: 'recarregando',
  crashed: 'caiu',
  unresponsive: 'travada',
  offline: 'sem conexão',
  paused: 'pausada'
}

export function statusOf(acc: AccountConfig, rt: AccountRuntime | undefined): DisplayStatus {
  if (!acc.enabled) return 'paused'
  return rt?.status ?? 'loading'
}

export const fmtMb = (mb: number): string =>
  mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`

export function fmtDuration(ms: number): string {
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'menos de 1 min'
  const h = Math.floor(min / 60)
  return h ? `${h} h ${min % 60} min` : `${min} min`
}

export const fmtTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
