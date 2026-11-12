import { net, session } from 'electron'
import { createHash } from 'node:crypto'
import type { ConfigStore } from './store'
import type { Logger } from './logger'
import { partitionFor, type AccountManager } from './accounts'

/**
 * Tira uma "impressão digital" da versão do jogo.
 * - Com regex: usa o grupo 1 (ou o match inteiro).
 * - Sem regex: usa a lista de .js/.css referenciados no HTML. Builds modernos (Next, Vite…)
 *   colocam hash no nome dos arquivos, então essa lista muda a cada deploy.
 * Retorna null se não conseguir identificar nada (nesse caso nunca dispara recarregamento).
 */
export function fingerprint(html: string, regex: string): string | null {
  if (regex.trim()) {
    try {
      const m = html.match(new RegExp(regex))
      if (m) return m[1] ?? m[0]
    } catch {
      /* regex inválida */
    }
    return null
  }
  const assets = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+?\.(?:m?js|css)(?:\?[^"']*)?)["']/gi)]
    .map((m) => m[1])
    .sort()
  return assets.length ? assets.join('|') : null
}

const short = (fp: string): string =>
  fp.length > 24 ? createHash('sha1').update(fp).digest('hex').slice(0, 8) : fp

export class UpdateWatcher {
  private baseline: string | null = null
  private pending: string | null = null
  private timer: NodeJS.Timeout | null = null
  private confirmTimer: NodeJS.Timeout | null = null
  private warnedNoFingerprint = false

  constructor(
    private readonly store: ConfigStore,
    private readonly log: Logger,
    private readonly manager: AccountManager
  ) {}

  restart(): void {
    this.stop()
    this.baseline = null
    this.pending = null
    this.warnedNoFingerprint = false
    const c = this.store.get()
    if (!c.updateWatch.enabled || !c.gameUrl) return
    this.timer = setInterval(() => void this.check(false), Math.max(1, c.updateWatch.intervalMin) * 60_000)
    void this.check(false)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.confirmTimer) clearTimeout(this.confirmTimer)
    this.timer = null
    this.confirmTimer = null
  }

  async check(manual: boolean): Promise<void> {
    const c = this.store.get()
    const url = c.updateWatch.versionUrl.trim() || c.gameUrl
    if (!url) return

    let html: string
    try {
      const u = new URL(url)
      u.searchParams.set('_deck', String(Date.now()))
      const init = { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } }
      // Usa a sessão da primeira conta, para mandar os mesmos cookies do jogo.
      const first = c.accounts[0]
      const res = first
        ? await session.fromPartition(partitionFor(first.id)).fetch(u.toString(), init)
        : await net.fetch(u.toString(), init)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      html = await res.text()
    } catch (err) {
      this.log.warn(null, `Verificação de atualização falhou: ${(err as Error).message}`)
      return
    }

    const fp = fingerprint(html, c.updateWatch.versionRegex)
    if (!fp) {
      if (!this.warnedNoFingerprint || manual) {
        this.log.warn(
          null,
          'Não consegui identificar a versão do jogo na página. Configure uma URL ou regex de versão nas configurações.'
        )
        this.warnedNoFingerprint = true
      }
      return
    }

    if (this.baseline === null) {
      this.baseline = fp
      this.log.info(null, `Versão atual do jogo registrada (${short(fp)})`)
      return
    }

    if (fp === this.baseline) {
      this.pending = null
      if (manual) this.log.info(null, 'Nenhuma atualização encontrada')
      return
    }

    // Confirma a mudança uma segunda vez antes de recarregar tudo (evita falso positivo de CDN).
    if (this.pending !== fp) {
      this.pending = fp
      this.log.info(null, 'Possível atualização detectada, confirmando em 30s…')
      if (this.confirmTimer) clearTimeout(this.confirmTimer)
      this.confirmTimer = setTimeout(() => {
        this.confirmTimer = null
        void this.check(false)
      }, 30_000)
      return
    }

    this.baseline = fp
    this.pending = null
    this.log.info(null, `Nova versão do jogo (${short(fp)}). Recarregando as contas em fila`)
    this.manager.reloadAll('atualização do jogo')
  }
}
