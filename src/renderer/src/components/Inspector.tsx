import { useEffect, useState } from 'react'
import type { AccountConfig, AccountRuntime, AppConfig, AutoStatus, LogEntry, MetricsSample } from '../../../shared/types'
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

      {config.auto.enabled && acc.enabled && (
        <AutoBox
          auto={rt?.auto ?? null}
          dryRun={config.auto.dryRun}
          on={!(config.auto.excludedIds ?? []).includes(acc.id)}
          onToggle={(on) => {
            const fora = (config.auto.excludedIds ?? []).filter((x) => x !== acc.id)
            update({ auto: { ...config.auto, excludedIds: on ? fora : [...fora, acc.id] } })
          }}
        />
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

const nf = new Intl.NumberFormat('pt-BR')
const n = (v: number): string => nf.format(Math.round(v))
const pct = (v: number): string => `${Math.round(v * 100)}%`

function AutoBox({
  auto,
  dryRun,
  on,
  onToggle
}: {
  auto: AutoStatus | null
  dryRun: boolean
  on: boolean
  onToggle(on: boolean): void
}) {
  const head = (
    <div className="metric-head">
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
        Automação{dryRun ? ' (simulação)' : ''}
      </label>
      <strong className={on ? (auto?.state ?? 'aguardando') : 'aguardando'}>
        {!on ? 'desligada nesta conta' : auto ? { ok: 'rodando', aguardando: 'aguardando', erro: 'parada' }[auto.state] : 'aguardando'}
      </strong>
    </div>
  )
  if (!on) return <div className="auto-box">{head}</div>
  return (
    <div className="auto-box">
      {head}
      {!auto && <span className="muted">Primeira verificação em até 1 min.</span>}
      {auto && auto.state !== 'ok' && <span className={auto.state}>{auto.message}</span>}
      {auto?.pokemon && (
        <span className="muted">
          {auto.pokemon}
          {auto.hpMax ? ` · HP ${n(auto.hpMax)}` : ''}
          {auto.limiar != null ? ` · poção abaixo de ${pct(auto.limiar)}` : ''}
        </span>
      )}
      {auto?.hunt && (
        <span className={auto.hunt.safe ? '' : 'risco'}>
          Agora: {auto.hunt.name} · {n(auto.hunt.xpH)} XP/h · golpe {pct(auto.hunt.hitPct)}
          {auto.hunt.safe ? '' : ' (acima do limite)'}
        </span>
      )}
      {auto?.best && auto.best.name !== auto.hunt?.name && (
        <span className="muted">
          Melhor segura: {auto.best.name} · {n(auto.best.xpH)} XP/h · golpe {pct(auto.best.hitPct)}
        </span>
      )}
      {auto?.huntNote && <span className="muted">Hunt: {auto.huntNote}</span>}
      {auto?.potion && (
        <span className="muted">
          Usando {auto.potion.name}: {n(auto.potion.stock)} · ~{n(auto.potion.perHour)}/h
          {auto.potion.hours != null && Number.isFinite(auto.potion.hours)
            ? ` · estoque dura ${auto.potion.hours.toFixed(1)} h`
            : ''}
        </span>
      )}
      {auto?.potionNote && <span className="muted">Compra: {auto.potionNote}</span>}
      {auto?.potion?.buy && auto.potion.buy !== auto.potion.name && (
        <span className="muted">Repõe com: {auto.potion.buy}</span>
      )}
      {auto?.version && <span className="muted small">Versão da automação: {auto.version}</span>}
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
