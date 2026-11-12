import { useState, type ReactNode } from 'react'
import type { AppConfig, UpdateWatchConfig, WatchdogConfig } from '../../../shared/types'
import { Icon } from './Icon'

interface Props {
  config: AppConfig
  onClose(): void
  onSave(patch: Partial<AppConfig>): void
}

export function Settings({ config, onClose, onSave }: Props) {
  const [gameUrl, setGameUrl] = useState(config.gameUrl)
  const [staggerSec, setStaggerSec] = useState(config.staggerSec)
  const [watchdog, setWatchdog] = useState<WatchdogConfig>(config.watchdog)
  const [updateWatch, setUpdateWatch] = useState<UpdateWatchConfig>(config.updateWatch)
  const [patterns, setPatterns] = useState(config.watchdog.disconnectPatterns.join('\n'))
  const [extensions, setExtensions] = useState(config.extensions.join('\n'))

  const setW = (p: Partial<WatchdogConfig>): void => setWatchdog((w) => ({ ...w, ...p }))
  const setU = (p: Partial<UpdateWatchConfig>): void => setUpdateWatch((u) => ({ ...u, ...p }))

  const save = (): void => {
    onSave({
      gameUrl: gameUrl.trim(),
      staggerSec: Math.max(0, staggerSec),
      watchdog: {
        ...watchdog,
        disconnectPatterns: patterns
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
      },
      updateWatch,
      extensions: extensions
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    })
    onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Configurações</h2>
          <button className="icon" onClick={onClose} title="Fechar">
            <Icon name="close" />
          </button>
        </header>

        <div className="modal-body">
          <fieldset>
            <legend>Jogo</legend>
            <Field label="URL do jogo">
              <input value={gameUrl} onChange={(e) => setGameUrl(e.target.value)} placeholder="https://…" />
            </Field>
            <Field label="Intervalo entre recarregamentos em fila (s)" hint="Evita recarregar todas as contas ao mesmo tempo.">
              <input type="number" min={0} value={staggerSec} onChange={(e) => setStaggerSec(Number(e.target.value))} />
            </Field>
          </fieldset>

          <fieldset>
            <legend>
              <label className="check">
                <input type="checkbox" checked={watchdog.enabled} onChange={(e) => setW({ enabled: e.target.checked })} />
                Gerenciamento automático (watchdog)
              </label>
            </legend>
            <p className="muted small">
              Contas que caem ou ficam sem conexão sempre são recarregadas. Aqui você ajusta as verificações extras.
            </p>
            <Field label="Checar a cada (s)">
              <input type="number" min={5} value={watchdog.checkIntervalSec} onChange={(e) => setW({ checkIntervalSec: Number(e.target.value) })} />
            </Field>
            <Field label="Reiniciar página travada após (s)">
              <input type="number" min={10} value={watchdog.unresponsiveGraceSec} onChange={(e) => setW({ unresponsiveGraceSec: Number(e.target.value) })} />
            </Field>
            <Field label="Recarregar se a conta passar de (MB)" hint="0 desliga.">
              <input type="number" min={0} value={watchdog.memoryLimitMb} onChange={(e) => setW({ memoryLimitMb: Number(e.target.value) })} />
            </Field>
            <Field
              label="Textos que indicam desconexão (um por linha)"
              hint='Use a frase exata da tela de desconexão do jogo, ex.: "conexão perdida". Evite palavras soltas que podem aparecer no chat.'
            >
              <textarea rows={3} value={patterns} onChange={(e) => setPatterns(e.target.value)} />
            </Field>
          </fieldset>

          <fieldset>
            <legend>
              <label className="check">
                <input type="checkbox" checked={updateWatch.enabled} onChange={(e) => setU({ enabled: e.target.checked })} />
                Recarregar quando o jogo atualizar
              </label>
            </legend>
            <Field label="Checar a cada (min)">
              <input type="number" min={1} value={updateWatch.intervalMin} onChange={(e) => setU({ intervalMin: Number(e.target.value) })} />
            </Field>
            <Field label="URL de versão (opcional)" hint="Vazio usa a URL do jogo. Se o jogo tiver um endpoint de versão, coloque aqui.">
              <input value={updateWatch.versionUrl} onChange={(e) => setU({ versionUrl: e.target.value })} placeholder="https://…/version.json" />
            </Field>
            <Field label="Regex de versão (opcional)" hint='Ex.: "version":"([^"]+)". Sem regex, o Deck compara os arquivos .js/.css da página.'>
              <input value={updateWatch.versionRegex} onChange={(e) => setU({ versionRegex: e.target.value })} />
            </Field>
          </fieldset>

          <fieldset>
            <legend>Extensões</legend>
            <Field
              label="Complementos da addons.mozilla.org (um por linha)"
              hint="Cole o link ou o nome curto, ex.: hunt-for-pokeidle. O Deck baixa, confere o hash e procura atualização a cada 6h. Só funcionam extensões que agem dentro da página (sem popup no ícone). Depois de mudar, recarregue as contas."
            >
              <textarea rows={3} value={extensions} onChange={(e) => setExtensions(e.target.value)} />
            </Field>
          </fieldset>
        </div>

        <footer className="modal-foot">
          <button className="ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" onClick={save}>
            Salvar
          </button>
        </footer>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  )
}
