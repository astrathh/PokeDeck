import type { AppConfig, LayoutMode } from '../../../shared/types'
import { Icon, type IconName } from './Icon'

interface Props {
  config: AppConfig
  update(patch: Partial<AppConfig>): void
  onReloadAll(): void
  onCheckUpdate(): void
}

const MODES: [LayoutMode, IconName, string][] = [
  ['grid', 'grid', 'Grade'],
  ['columns', 'columns', 'Colunas'],
  ['focus', 'single', 'Foco']
]

export function Toolbar({ config, update, onReloadAll, onCheckUpdate }: Props) {
  return (
    <div className="toolbar">
      <div className="seg">
        {MODES.map(([mode, icon, label]) => (
          <button
            key={mode}
            className={config.layout === mode ? 'on' : ''}
            onClick={() => update({ layout: mode })}
            title={label}
          >
            <Icon name={icon} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <button
        className={`toggle ${config.economy ? 'on' : ''}`}
        onClick={() => update({ economy: !config.economy })}
        title="Só a conta selecionada é desenhada na tela; as outras continuam rodando em segundo plano"
      >
        <Icon name="leaf" /> Econômico
      </button>

      <div className="spacer" />

      <button className="ghost" onClick={onCheckUpdate} title="Compara a versão do jogo agora">
        <Icon name="update" /> Checar atualização
      </button>
      <button className="ghost" onClick={onReloadAll} title="Recarrega todas, uma por vez">
        <Icon name="reload" /> Recarregar todas
      </button>
    </div>
  )
}
