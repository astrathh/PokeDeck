import { useEffect, useState } from 'react'
import type { AccountConfig, AccountRuntime, AppConfig, LogEntry, MetricsSample } from '../../../shared/types'
import { fmtDuration, fmtMb, fmtTime, STATUS_LABEL, statusOf } from '../format'
import { Icon } from './Icon'
import { Sparkline } from './Sparkline'

interface Props {
  config: AppConfig
  runtime: Record<string, AccountRuntime>
  history: MetricsSample[]
  logs: LogEntry[]
  selected: string | null
  update(patch: Partial<AppConfig>): void
  onRemove(id: string): void
}

export function Inspector({ config, runtime, history, logs, selected, update, onRemove }: Props) {
  const acc = config.accounts.find((a) => a.id === selected)
  return (
    <aside className="inspector">
      {acc ? (
        <AccountPanel
          key={acc.id}
          acc={acc}
          config={config}
          rt={runtime[acc.id]}
          history={history}
          update={update}
          onRemove={onRemove}
        />
      ) : (
        <p className="muted pad">Nenhuma conta selecionada.</p>
      )}
      <EventList logs={logs} accountId={acc?.id ?? null} names={config.accounts} />
    </aside>
  )
}

function AccountPanel({
  acc,
  config,
  rt,
  history,
  update,
  onRemove
}: {
  acc: AccountConfig
  config: AppConfig
  rt: AccountRuntime | undefined
  history: MetricsSample[]
  update(patch: Partial<AppConfig>): void
  onRemove(id: string): void
}) {
  const [name, setName] = useState(acc.name)
  useEffect(() => setName(acc.name), [acc.name])

  const patchAcc = (p: Partial<AccountConfig>): void =>
    update({ accounts: config.accounts.map((a) => (a.id === acc.id ? { ...a, ...p } : a)) })

  const commitName = (): void => {
    const n = name.trim()
    if (n && n !== acc.name) patchAcc({ name: n })
    else setName(acc.name)
  }

  const st = statusOf(acc, rt)
  const mem = history.map((h) => h.accounts[acc.id]?.memoryMb ?? 0)
  const cpu = history.map((h) => h.accounts[acc.id]?.cpu ?? 0)
  const act = (a: Parameters<typeof window.deck.action>[1]) => () => void window.deck.action(acc.id, a)

  return (
    <div className="panel">
      <input
        className="name-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <div className={`status st-${st}`}>
        <span className="dot" />
        {STATUS_LABEL[st]}
        {st === 'ready' && rt ? ` há ${fmtDuration(Date.now() - rt.since)}` : ''}
      </div>
      {rt?.lastEvent && st !== 'ready' && <div className="muted small">{rt.lastEvent}</div>}
      {rt?.url && (
        <div className="muted small url" title={rt.url}>
          {rt.url}
        </div>
      )}

      {acc.enabled && (
        <div className="metrics">
          <div className="metric-head">
            <span>Memória (última hora)</span>
            <strong>{fmtMb(rt?.memoryMb ?? 0)}</strong>
          </div>
          <Sparkline values={mem} max={config.watchdog.memoryLimitMb || undefined} />
          <div className="metric-head">
            <span>CPU</span>
            <strong>{Math.round(rt?.cpu ?? 0)}%</strong>
          </div>
          <Sparkline values={cpu} max={100} color="var(--green)" />
        </div>
      )}

      <div className="actions">
        <button onClick={act('reload')} disabled={!acc.enabled}>
          <Icon name="reload" /> Recarregar
        </button>
        <button onClick={act('hardReload')} disabled={!acc.enabled}>
          <Icon name="reload" /> Sem cache
        </button>
        <button onClick={act('home')} disabled={!acc.enabled}>
          <Icon name="home" /> Início do jogo
        </button>
        <button onClick={act('devtools')} disabled={!acc.enabled}>
          <Icon name="code" /> DevTools
        </button>
        <button onClick={() => patchAcc({ muted: !acc.muted })}>
          <Icon name={acc.muted ? 'volume' : 'mute'} /> {acc.muted ? 'Ativar som' : 'Mutar'}
        </button>
        <button onClick={() => patchAcc({ enabled: !acc.enabled })}>
          <Icon name={acc.enabled ? 'pause' : 'play'} /> {acc.enabled ? 'Pausar' : 'Retomar'}
        </button>
        <button
          className="danger"
          disabled={!acc.enabled}
          onClick={() => {
            if (confirm(`Sair da conta "${acc.name}"? Os cookies e dados salvos dela serão apagados.`))
              void window.deck.action(acc.id, 'logout')
          }}
        >
          <Icon name="logout" /> Sair da conta
        </button>
        <button
          className="danger"
          onClick={() => {
            if (confirm(`Remover "${acc.name}" do Deck? A sessão dela será apagada.`)) onRemove(acc.id)
          }}
        >
          <Icon name="trash" /> Remover
        </button>
      </div>
    </div>
  )
}

function EventList({
  logs,
  accountId,
  names
}: {
  logs: LogEntry[]
  accountId: string | null
  names: AccountConfig[]
}) {
  const items = logs
    .filter((l) => !accountId || l.accountId === accountId || l.accountId === null)
    .slice(-80)
    .reverse()
  const nameOf = (id: string | null): string => (id ? (names.find((n) => n.id === id)?.name ?? id) : 'Deck')
  return (
    <div className="events">
      <div className="section-label">Eventos</div>
      <ul>
        {items.map((l, i) => (
          <li key={`${l.ts}-${i}`} className={`ev ev-${l.level}`}>
            <span className="ev-time">{fmtTime(l.ts)}</span>
            <span className="ev-src">{nameOf(l.accountId)}</span>
            <span className="ev-msg">{l.message}</span>
          </li>
        ))}
        {!items.length && <li className="muted small">Nada por enquanto.</li>}
      </ul>
    </div>
  )
}
