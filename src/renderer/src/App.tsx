import { useCallback, useEffect, useRef, useState } from 'react'
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

      <UpdateToasts u={appUpdate} onInstall={() => void deck.installAppUpdate()} />

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

const RELEASES = 'https://github.com/astrathh/PokeDeck/releases'
const LAST_VERSION_KEY = 'pokedeck.lastVersion'
const TOAST_MS = 15_000

interface Toast {
  id: string
  title: string
  text: string
  action?: { label: string; run(): void }
  /** Texto do botão que só fecha (padrão: "Fechar") */
  dismiss?: string
}

/**
 * Avisos temporários no canto superior esquerdo (em cima da barra lateral: as telas das contas são
 * desenhadas por cima do HTML da área central e esconderiam qualquer coisa ali).
 * - atualização baixada e pronta para instalar (uma vez por versão);
 * - primeira abertura depois de atualizar.
 */
function UpdateToasts({ u, onInstall }: { u: AppUpdateState | null; onInstall(): void }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const shown = useRef(new Set<string>())

  const push = useCallback((t: Toast) => {
    if (shown.current.has(t.id)) return
    shown.current.add(t.id)
    setToasts((list) => [...list, t])
  }, [])
  const close = useCallback((id: string) => setToasts((list) => list.filter((t) => t.id !== id)), [])

  // Primeira abertura numa versão nova (o PokeDeck acabou de se atualizar).
  useEffect(() => {
    if (!u || u.state === 'dev') return
    let last: string | null = null
    try {
      last = localStorage.getItem(LAST_VERSION_KEY)
      localStorage.setItem(LAST_VERSION_KEY, u.current)
    } catch {
      return
    }
    if (last && last !== u.current) {
      push({
        id: `updated-${u.current}`,
        title: `PokeDeck atualizado para a ${u.current}`,
        text: 'Tudo pronto: contas e configurações continuam como estavam.',
        action: { label: 'Ver novidades', run: () => window.open(`${RELEASES}/tag/v${u.current}`) }
      })
    }
    // só na abertura: a versão instalada não muda com o app aberto
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [u?.current])

  // Versão nova baixada.
  useEffect(() => {
    if (u?.state !== 'ready' || !u.version) return
    push({
      id: `ready-${u.version}`,
      title: `Atualização pronta: ${u.version}`,
      text: 'Reinicie para instalar. Se preferir, ela instala sozinha quando o PokeDeck fechar.',
      action: { label: 'Reiniciar agora', run: onInstall },
      dismiss: 'Depois'
    })
  }, [u?.state, u?.version, onInstall, push])

  if (!toasts.length) return null
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <ToastCard key={t.id} t={t} onClose={() => close(t.id)} />
      ))}
    </div>
  )
}

function ToastCard({ t, onClose }: { t: Toast; onClose(): void }) {
  const [hover, setHover] = useState(false)
  // Some sozinho; com o mouse em cima, espera.
  useEffect(() => {
    if (hover) return
    const timer = setTimeout(onClose, TOAST_MS)
    return () => clearTimeout(timer)
  }, [hover, onClose])
  return (
    <div className="toast" role="status" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="toast-head">
        <strong>{t.title}</strong>
        <button className="icon toast-close" onClick={onClose} title="Fechar">
          ×
        </button>
      </div>
      <span className="muted">{t.text}</span>
      {t.action && (
        <div className="toast-actions">
          <button className="primary" onClick={() => { t.action?.run(); onClose() }}>
            {t.action.label}
          </button>
          <button className="ghost" onClick={onClose}>
            {t.dismiss ?? 'Fechar'}
          </button>
        </div>
      )}
      {!hover && <div className="toast-timer" style={{ animationDuration: `${TOAST_MS}ms` }} />}
    </div>
  )
}
