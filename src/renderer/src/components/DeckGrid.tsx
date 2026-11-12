import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { AccountRuntime, AppConfig, Rect } from '../../../shared/types'
import { fmtMb, STATUS_LABEL, statusOf } from '../format'
import { Icon } from './Icon'

interface Props {
  config: AppConfig
  runtime: Record<string, AccountRuntime>
  selected: string | null
  onSelect(id: string): void
  update(patch: Partial<AppConfig>): void
}

/**
 * Desenha os "slots" das contas. Cada slot tem um <div> vazio (slot-body) que é medido
 * e cujo retângulo vai para o processo principal, que posiciona a view do jogo por cima.
 */
export function DeckGrid({ config, runtime, selected, onSelect, update }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bodies = useRef(new Map<string, HTMLDivElement>())
  const frame = useRef(0)
  /** Último layout enviado; evita IPC + setBounds em toda re-renderização (as métricas chegam a cada 2s). */
  const lastSent = useRef('')

  const enabled = config.accounts.filter((a) => a.enabled)
  const current = selected && enabled.some((a) => a.id === selected) ? selected : (enabled[0]?.id ?? null)
  const shown = config.layout === 'focus' ? enabled.filter((a) => a.id === current) : enabled
  const cols = config.layout === 'columns' ? Math.max(1, shown.length) : Math.max(1, Math.ceil(Math.sqrt(shown.length)))
  const rows = Math.max(1, Math.ceil(shown.length / cols))

  const isLive = (id: string): boolean => {
    if (runtime[id]?.detached) return false
    if (config.economy && id !== current) return false
    return true
  }

  const measure = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const rects: Record<string, Rect | null> = {}
      for (const a of config.accounts) rects[a.id] = null
      bodies.current.forEach((el, id) => {
        const r = el.getBoundingClientRect()
        rects[id] = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
      })
      const key = JSON.stringify(rects)
      if (key === lastSent.current) return
      lastSent.current = key
      window.deck.setBounds(rects)
    })
  }, [config.accounts])

  // Mede depois de todo render (troca de layout, conta destacada, etc.)
  useLayoutEffect(() => {
    measure()
  })

  // …e quando a janela ou a área do grid mudam de tamanho.
  useEffect(() => {
    const ro = new ResizeObserver(measure)
    if (containerRef.current) ro.observe(containerRef.current)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
      cancelAnimationFrame(frame.current)
    }
  }, [measure])

  if (!enabled.length) {
    return (
      <div className="deck-empty" ref={containerRef}>
        {config.accounts.length ? 'Todas as contas estão pausadas.' : 'Adicione uma conta na barra lateral para começar.'}
      </div>
    )
  }

  return (
    <div
      className="deck"
      ref={containerRef}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
    >
      {shown.map((a) => {
        const rt = runtime[a.id]
        const st = statusOf(a, rt)
        const live = isLive(a.id)
        const toggleMute = (): void =>
          update({ accounts: config.accounts.map((x) => (x.id === a.id ? { ...x, muted: !x.muted } : x)) })
        return (
          <section
            key={a.id}
            className={`slot ${current === a.id ? 'is-selected' : ''}`}
            onMouseDown={() => onSelect(a.id)}
          >
            <header className="slot-head">
              <span className={`status st-${st}`}>
                <span className="dot" />
              </span>
              <span className="slot-name">{a.name}</span>
              <span className="slot-meta">
                {STATUS_LABEL[st]}
                {rt ? ` · ${fmtMb(rt.memoryMb)}` : ''}
              </span>
              <div className="slot-actions">
                <button title="Recarregar" onClick={() => void window.deck.action(a.id, 'reload')}>
                  <Icon name="reload" />
                </button>
                <button title={a.muted ? 'Ativar som' : 'Mutar'} onClick={toggleMute}>
                  <Icon name={a.muted ? 'mute' : 'volume'} />
                </button>
                <button
                  title={config.layout === 'focus' ? 'Voltar para a grade' : 'Focar nesta conta'}
                  onClick={() => {
                    onSelect(a.id)
                    update({ layout: config.layout === 'focus' ? 'grid' : 'focus' })
                  }}
                >
                  <Icon name="focus" />
                </button>
                <button
                  title={rt?.detached ? 'Trazer de volta' : 'Abrir em janela separada'}
                  onClick={() => void window.deck.action(a.id, rt?.detached ? 'attach' : 'detach')}
                >
                  <Icon name={rt?.detached ? 'attach' : 'detach'} />
                </button>
              </div>
            </header>

            {live ? (
              <div
                className="slot-body"
                ref={(el) => {
                  if (el) bodies.current.set(a.id, el)
                  else bodies.current.delete(a.id)
                }}
              >
                {rt?.status !== 'ready' && <div className="slot-loading">{rt?.lastEvent ?? STATUS_LABEL[st]}…</div>}
              </div>
            ) : (
              <div className="slot-placeholder">
                {rt?.detached ? (
                  <>
                    <p>Aberta em janela separada</p>
                    <button className="ghost" onClick={() => void window.deck.action(a.id, 'attach')}>
                      <Icon name="attach" /> Trazer de volta
                    </button>
                  </>
                ) : (
                  <>
                    <p>Rodando em segundo plano</p>
                    <span className="muted">Modo econômico: clique para ver esta conta</span>
                  </>
                )}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
