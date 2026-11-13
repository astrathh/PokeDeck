import { useCallback, useEffect, useState } from 'react'
import type { AccountRuntime, AppConfig, AppUpdateState, LogEntry, MetricsSample } from '../../shared/types'
import { fmtMb } from './format'
import { DeckGrid } from './components/DeckGrid'
import { Inspector } from './components/Inspector'
import { Settings } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { Welcome } from './components/Welcome'

/** 1 hora de amostras, uma a cada 2s */
const HISTORY_SIZE = 1800

const toMap = (list: AccountRuntime[]): Record<string, AccountRuntime> =>
  Object.fromEntries(list.map((r) => [r.id, r]))

export function App() {
  const deck = window.deck
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [runtime, setRuntime] = useState<Record<string, AccountRuntime>>({})
  const [history, setHistory] = useState<MetricsSample[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [appUpdate, setAppUpdate] = useState<AppUpdateState | null>(null)

  // A conta selecionada roda sem limite de FPS; as outras, com o limite das Configurações.
  useEffect(() => deck.setSelected(selected), [deck, selected])

  useEffect(() => {
    void deck.getAppUpdate().then(setAppUpdate)
    return deck.onAppUpdate(setAppUpdate)
  }, [deck])

  useEffect(() => {
    void deck.getConfig().then(setConfig)
    void deck.getLogs().then(setLogs)
    void deck.getRuntime().then((r) => setRuntime(toMap(r)))
    const offs = [
      deck.onConfig(setConfig),
      deck.onRuntime((r) => setRuntime(toMap(r))),
      deck.onMetrics((s) =>
        setHistory((h) => {
          const next = h.length >= HISTORY_SIZE ? h.slice(h.length - HISTORY_SIZE + 1) : h.slice()
          next.push(s)
          return next
        })
      ),
      deck.onLog((e) => setLogs((l) => [...l.slice(-999), e])),
      deck.onFocused(setSelected)
    ]
    return () => offs.forEach((off) => off())
  }, [deck])

  // As views do jogo ficam por cima do HTML; esconde enquanto o modal está aberto.
  useEffect(() => {
    deck.setOverlay(settingsOpen)
  }, [deck, settingsOpen])

  useEffect(() => {
    if (config && (!selected || !config.accounts.some((a) => a.id === selected))) {
      setSelected(config.accounts[0]?.id ?? null)
    }
  }, [config, selected])

  const update = useCallback(
    (patch: Partial<AppConfig>) => {
      void deck.updateConfig(patch).then(setConfig)
    },
    [deck]
  )

  const addAccount = async (): Promise<void> => {
    const next = await deck.addAccount()
    setConfig(next)
    setSelected(next.accounts[next.accounts.length - 1]?.id ?? null)
  }

  const removeAccount = async (id: string): Promise<void> => {
    setConfig(await deck.removeAccount(id))
  }

  if (!config) return <div className="boot">Carregando…</div>

  const last = history[history.length - 1]

  return (
    <div className="app">
      <Sidebar
        config={config}
        runtime={runtime}
        selected={selected}
        onSelect={setSelected}
        onAdd={() => void addAccount()}
        onSettings={() => setSettingsOpen(true)}
      />

      <main className="main">
        <Toolbar
          config={config}
          update={update}
          onReloadAll={() => void deck.reloadAll()}
          onCheckUpdate={() => void deck.checkUpdateNow()}
        />
        {config.gameUrl ? (
          <DeckGrid config={config} runtime={runtime} selected={selected} onSelect={setSelected} update={update} />
        ) : (
          <Welcome onSave={(gameUrl) => update({ gameUrl })} />
        )}
        <footer className="statusbar">
          <span>{config.accounts.filter((a) => a.enabled).length} contas ativas</span>
          {last && (
            <>
              <span>RAM total {fmtMb(last.totalMemoryMb)}</span>
              <span>CPU {Math.round(last.totalCpu)}%</span>
            </>
          )}
          <span className="spacer" />
          <span className="muted">{config.gameUrl}</span>
          <AppVersion u={appUpdate} onCheck={() => void deck.checkAppUpdate()} onInstall={() => void deck.installAppUpdate()} />
        </footer>
      </main>

      <Inspector
        config={config}
        runtime={runtime}
        history={history}
        logs={logs}
        selected={selected}
        update={update}
        onRemove={(id) => void removeAccount(id)}
      />

      {settingsOpen && <Settings config={config} onClose={() => setSettingsOpen(false)} onSave={update} />}
    </div>
  )
}

/** Versão do PokeDeck na barra de status + aviso de atualização baixada. */
function AppVersion({ u, onCheck, onInstall }: { u: AppUpdateState | null; onCheck(): void; onInstall(): void }) {
  if (!u) return null
  if (u.state === 'ready') {
    return (
      <button className="update-ready" onClick={onInstall} title="Fecha o PokeDeck, instala e abre de novo">
        PokeDeck {u.version} pronto: reiniciar e atualizar
      </button>
    )
  }
  const extra =
    u.state === 'dev'
      ? ' (dev)'
      : u.state === 'checking'
        ? ' · procurando atualização…'
        : u.state === 'downloading'
          ? ` · baixando ${u.version} (${u.percent ?? 0}%)`
          : u.state === 'error'
            ? ' · não consegui procurar atualização'
            : ''
  return (
    <span
      className="muted app-version"
      title={u.state === 'dev' ? 'Rodando com npm run dev: não atualiza sozinho' : 'Clique para procurar atualização agora'}
      onClick={u.state === 'dev' ? undefined : onCheck}
    >
      v{u.current}
      {extra}
    </span>
  )
}
