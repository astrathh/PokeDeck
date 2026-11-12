import type { AccountRuntime, AppConfig } from '../../../shared/types'
import { fmtMb, STATUS_LABEL, statusOf } from '../format'
import { Icon } from './Icon'

interface Props {
  config: AppConfig
  runtime: Record<string, AccountRuntime>
  selected: string | null
  onSelect(id: string): void
  onAdd(): void
  onSettings(): void
}

export function Sidebar({ config, runtime, selected, onSelect, onAdd, onSettings }: Props) {
  const active = config.accounts.filter((a) => a.enabled).length
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" />
        Deck
      </div>

      <div className="section-label">
        Contas
        <span>
          {active}/{config.accounts.length} ativas
        </span>
      </div>

      <ul className="account-list">
        {config.accounts.map((a, i) => {
          const rt = runtime[a.id]
          const st = statusOf(a, rt)
          return (
            <li
              key={a.id}
              className={`account ${selected === a.id ? 'is-selected' : ''}`}
              onClick={() => onSelect(a.id)}
            >
              <span className="avatar">C{i + 1}</span>
              <div className="account-info">
                <div className="account-name">{a.name}</div>
                <div className={`status st-${st}`}>
                  <span className="dot" />
                  {STATUS_LABEL[st]}
                  {rt?.detached ? ' · janela' : ''}
                </div>
              </div>
              <span className="account-mem">{rt && a.enabled ? fmtMb(rt.memoryMb) : '—'}</span>
            </li>
          )
        })}
      </ul>

      <button className="add-account" onClick={onAdd}>
        <Icon name="plus" /> Adicionar conta
      </button>

      <div className="sidebar-foot">
        <button className="ghost" onClick={onSettings}>
          <Icon name="settings" /> Configurações
        </button>
      </div>
    </aside>
  )
}
