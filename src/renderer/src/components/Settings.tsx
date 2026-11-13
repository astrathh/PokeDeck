import { useState, type ReactNode } from 'react'
import type { AppConfig, AutoConfig, UpdateWatchConfig, WatchdogConfig } from '../../../shared/types'
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

  const [auto, setAuto] = useState<AutoConfig>(config.auto)
  const setA = (p: Partial<AutoConfig>): void => setAuto((a) => ({ ...a, ...p }))
  const setAP = (p: Partial<AutoConfig['potions']>): void => setAuto((a) => ({ ...a, potions: { ...a.potions, ...p } }))
  const setAH = (p: Partial<AutoConfig['hunts']>): void => setAuto((a) => ({ ...a, hunts: { ...a.hunts, ...p } }))
  const nonNeg = (v: string): number => Math.max(0, Number(v) || 0)

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
      auto,
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
            <Field label="Regex de versão (opcional)" hint='Ex.: "version":"([^"]+)". Sem regex, o PokeDeck compara os arquivos .js/.css da página.'>
              <input value={updateWatch.versionRegex} onChange={(e) => setU({ versionRegex: e.target.value })} />
            </Field>
          </fieldset>

          <fieldset>
            <legend>
              <label className="check">
                <input type="checkbox" checked={auto.enabled} onChange={(e) => setA({ enabled: e.target.checked })} />
                Automação (poções e hunts)
              </label>
            </legend>
            <p className="muted small">
              Vale para todas as contas. Usa o ranking do /hunt e manda as mesmas ações dos botões do jogo. Os termos do
              Pokeidle permitem automação que siga as regras de quem joga na mão.
            </p>
            <label className="check">
              <input type="checkbox" checked={auto.dryRun} onChange={(e) => setA({ dryRun: e.target.checked })} />
              Modo simulação: só registra em Eventos o que faria
            </label>
            <div className="field">
              <span>Rodar nas contas</span>
              <div className="check-list">
                {config.accounts.map((a) => {
                  const fora = (auto.excludedIds ?? []).includes(a.id)
                  return (
                    <label key={a.id} className="check">
                      <input
                        type="checkbox"
                        checked={!fora}
                        onChange={(e) =>
                          setA({
                            excludedIds: e.target.checked
                              ? (auto.excludedIds ?? []).filter((x) => x !== a.id)
                              : [...(auto.excludedIds ?? []), a.id]
                          })
                        }
                      />
                      {a.name}
                    </label>
                  )
                })}
              </div>
              <small className="muted">Conta nova entra ligada. Também dá para ligar/desligar no painel da conta.</small>
            </div>
            <Field label="Reavaliar as hunts a cada (min)">
              <input type="number" min={1} value={auto.intervalMin} onChange={(e) => setA({ intervalMin: Math.max(1, Number(e.target.value) || 1) })} />
            </Field>

            <label className="check">
              <input type="checkbox" checked={auto.potions.enabled} onChange={(e) => setAP({ enabled: e.target.checked })} />
              Comprar poção no NPC
            </label>
            <p className="muted small">
              Escolhe a poção de menor preço por HP útil para o pokémon em campo: com a poção disparando abaixo do limiar do
              jogo, o que ela curar além de (100% − limiar) do HP máximo é desperdício. Usa primeiro as poções que já estão no
              estoque (a melhor delas); compra a ideal quando o estoque somado não dá para o tempo abaixo.
            </p>
            <label className="check">
              <input type="checkbox" checked={auto.potions.manageList} onChange={(e) => setAP({ manageList: e.target.checked })} />
              Gerenciar "Usar Poções" do jogo: deixar marcada só a melhor que a conta tem para o pokémon (quando acaba, marca a próxima na hora)
            </label>
            <div className="row2">
              <Field label="Comprar quando durar menos de (h)">
                <input type="number" min={0} step={0.5} value={auto.potions.refillBelowHours} onChange={(e) => setAP({ refillBelowHours: nonNeg(e.target.value) })} />
              </Field>
              <Field label="Completar até (h)">
                <input type="number" min={0} step={0.5} value={auto.potions.stockHours} onChange={(e) => setAP({ stockHours: nonNeg(e.target.value) })} />
              </Field>
            </div>
            <Field label="Uma compra nunca passa de (% do ouro)">
              <input type="number" min={1} max={100} value={auto.potions.maxGoldPct} onChange={(e) => setAP({ maxGoldPct: Math.min(100, Math.max(1, Number(e.target.value) || 1)) })} />
            </Field>

            <label className="check">
              <input type="checkbox" checked={auto.hunts.enabled} onChange={(e) => setAH({ enabled: e.target.checked })} />
              Trocar para a hunt de maior XP/h do treinador
            </label>
            <p className="muted small">
              Só entram hunts liberadas em que o pior golpe do selvagem é menor que o limiar da poção (senão pode matar antes
              da poção disparar) e não mata de uma vez. Hunt atual acima do limite: troca na hora. Fora de hunt (no
              Centro Pokémon), vai para a melhor hunt segura.
            </p>
            <label className="check">
              <input type="checkbox" checked={auto.hunts.viaCenter} onChange={(e) => setAH({ viaCenter: e.target.checked })} />
              Voltar ao Centro Pokémon antes de ir para a hunt nova
            </label>
            <p className="muted small">
              Desligado: troca direto de uma hunt para outra. Nos dois casos espera a trava de combate do jogo (3 s sem
              golpe) e nunca usa "desistir do combate".
            </p>
            <Field label="Tempo mínimo na hunt (min)" hint="Evita ficar trocando entre hunts parecidas por oscilação da estimativa de XP/h.">
              <input type="number" min={0} value={auto.hunts.minStayMin} onChange={(e) => setAH({ minStayMin: nonNeg(e.target.value) })} />
            </Field>
            <div className="row2">
              <Field label="Nível baixo: até">
                <input type="number" min={0} value={auto.hunts.lowLevel} onChange={(e) => setAH({ lowLevel: nonNeg(e.target.value) })} />
              </Field>
              <Field label="Nível de quem">
                <select value={auto.hunts.levelOf} onChange={(e) => setAH({ levelOf: e.target.value as AutoConfig['hunts']['levelOf'] })}>
                  <option value="trainer">Treinador</option>
                  <option value="pokemon">Pokémon em campo</option>
                </select>
              </Field>
            </div>
            <Field label="Nível baixo: pior golpe até (% do HP máximo)">
              <input type="number" min={1} max={100} value={auto.hunts.lowLevelMaxHitPct} onChange={(e) => setAH({ lowLevelMaxHitPct: Math.min(100, Math.max(1, Number(e.target.value) || 1)) })} />
            </Field>
            <label className="check">
              <input type="checkbox" checked={auto.hunts.requirePositiveGold} onChange={(e) => setAH({ requirePositiveGold: e.target.checked })} />
              Recusar hunts em que a poção custa mais que o ouro que a hunt rende
            </label>
          </fieldset>

          <fieldset>
            <legend>Extensões</legend>
            <Field
              label="Complementos da addons.mozilla.org (um por linha)"
              hint="Cole o link ou o nome curto, ex.: hunt-for-pokeidle. O PokeDeck baixa, confere o hash e procura atualização a cada 6h. Só funcionam extensões que agem dentro da página (sem popup no ícone). Depois de mudar, recarregue as contas."
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
