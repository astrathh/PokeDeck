import { app, net, type Session } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import type { ConfigStore } from './store'
import type { Logger } from './logger'

/** De quanto em quanto tempo procura versão nova das extensões na loja do Firefox. */
const UPDATE_INTERVAL_MS = 6 * 60 * 60_000
/** Na primeira vez (extensão ainda não baixada), quanto as contas esperam o download antes de abrir sem ela. */
const FIRST_DOWNLOAD_WAIT_MS = 20_000

const AMO_API = 'https://addons.mozilla.org/api/v5/addons/addon/'

interface Installed {
  slug: string
  version: string
  dir: string
}

/** Aceita o slug ("hunt-for-pokeidle") ou o link da página do complemento. */
export function slugFrom(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  const m = s.match(/addons\.mozilla\.org\/(?:[^/]+\/)?(?:firefox\/)?addon\/([^/?#]+)/i)
  const slug = m ? decodeURIComponent(m[1]) : s
  return /^[\w.-]+$/.test(slug) ? slug.toLowerCase() : null
}

/** Extrai um .zip/.xpi (métodos stored e deflate), recusando caminhos que saiam da pasta. */
function unzip(buf: Buffer, dest: string): void {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('arquivo zip inválido')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const root = resolve(dest)

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('diretório central do zip inválido')
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen

    if (name.endsWith('/')) continue
    const out = resolve(root, name)
    if (!out.startsWith(root + sep)) throw new Error(`caminho suspeito no zip: ${name}`)

    const lNameLen = buf.readUInt16LE(localOff + 26)
    const lExtraLen = buf.readUInt16LE(localOff + 28)
    const start = localOff + 30 + lNameLen + lExtraLen
    const data = buf.subarray(start, start + compSize)
    let content: Buffer
    if (method === 0) content = data
    else if (method === 8) content = inflateRawSync(data)
    else throw new Error(`compressão ${method} não suportada (${name})`)

    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, content)
  }
}

/**
 * Extensões do Firefox/Chrome (só content scripts) baixadas da addons.mozilla.org e carregadas
 * na sessão de cada conta. Ficam em %APPDATA%/deck-multiconta/extensions/<slug>/<versão>/.
 *
 * Content scripts entram quando a página carrega: extensão nova ou atualizada só aparece numa
 * conta depois que ela recarrega.
 */
export class ExtensionManager {
  private installed = new Map<string, Installed>()
  private sessions = new Set<Session>()
  private timer: NodeJS.Timeout | null = null
  /** Resolve quando as extensões já baixadas estão prontas (e as novas baixaram ou desistiram). */
  private ready: Promise<void> = Promise.resolve()
  private refreshing: Promise<void> | null = null

  constructor(
    private readonly store: ConfigStore,
    private readonly log: Logger
  ) {}

  private get root(): string {
    return join(app.getPath('userData'), 'extensions')
  }

  private wanted(): string[] {
    const slugs = this.store.get().extensions.map(slugFrom).filter((s): s is string => s !== null)
    return [...new Set(slugs)]
  }

  start(): void {
    this.stop()
    this.ready = this.refresh()
    this.timer = setInterval(() => void this.refresh(), UPDATE_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Chamado ao criar cada conta, antes de abrir o jogo. */
  async attach(ses: Session): Promise<void> {
    this.sessions.add(ses)
    await this.ready
    await this.applyTo(ses)
  }

  detach(ses: Session): void {
    this.sessions.delete(ses)
  }

  /** Relê a lista da config, usa o que já está no disco e procura atualizações na loja. */
  refresh(): Promise<void> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  private async doRefresh(): Promise<void> {
    const slugs = this.wanted()

    // 1) O que já está baixado vale na hora (abre rápido e funciona offline).
    this.installed.clear()
    for (const slug of slugs) {
      const local = this.newestLocal(slug)
      if (local) this.installed.set(slug, local)
    }
    await this.applyAll()

    // 2) Atualizações. As que ainda não existem no disco seguram as contas um pouco, para a
    //    primeira abertura já vir com a extensão; as demais atualizam em segundo plano.
    const missing = slugs.filter((s) => !this.installed.has(s))
    const updates = slugs.map((slug) => this.update(slug))
    if (missing.length) {
      await Promise.race([
        Promise.allSettled(updates),
        new Promise((r) => setTimeout(r, FIRST_DOWNLOAD_WAIT_MS))
      ])
    }
    void Promise.allSettled(updates).then(async (results) => {
      if (results.some((r) => r.status === 'fulfilled' && r.value)) await this.applyAll()
    })
  }

  /** Baixa a versão atual da loja se for diferente da instalada. Retorna true se trocou. */
  private async update(slug: string): Promise<boolean> {
    try {
      const res = await net.fetch(AMO_API + encodeURIComponent(slug) + '/')
      if (res.status === 404) throw new Error('não encontrada na addons.mozilla.org')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const info = (await res.json()) as {
        name?: Record<string, string>
        current_version?: { version: string; file: { url: string; hash: string } }
      }
      const cur = info.current_version
      if (!cur) throw new Error('sem versão publicada')
      const name = info.name?.['pt-BR'] ?? info.name?.['en-US'] ?? Object.values(info.name ?? {})[0] ?? slug
      if (this.installed.get(slug)?.version === cur.version) return false

      const fileRes = await net.fetch(cur.file.url)
      if (!fileRes.ok) throw new Error(`download HTTP ${fileRes.status}`)
      const buf = Buffer.from(await fileRes.arrayBuffer())
      const [algo, expected] = cur.file.hash.split(':')
      if (algo !== 'sha256' || createHash('sha256').update(buf).digest('hex') !== expected) {
        throw new Error('o arquivo baixado não bate com o hash da loja')
      }

      const safeVersion = cur.version.replace(/[^\w.-]/g, '_')
      const dir = join(this.root, slug, safeVersion)
      const tmp = `${dir}.tmp-${Date.now()}`
      unzip(buf, tmp)
      if (!existsSync(join(tmp, 'manifest.json'))) throw new Error('pacote sem manifest.json')
      rmSync(dir, { recursive: true, force: true })
      renameSync(tmp, dir)

      const prev = this.installed.get(slug)
      this.installed.set(slug, { slug, version: cur.version, dir })
      this.log.info(
        null,
        prev
          ? `Extensão ${name} atualizada para ${cur.version}. Recarregue as contas para aplicar`
          : `Extensão ${name} ${cur.version} instalada`
      )
      return true
    } catch (err) {
      this.log.warn(null, `Extensão "${slug}": ${(err as Error).message}`)
      return false
    }
  }

  private newestLocal(slug: string): Installed | null {
    const base = join(this.root, slug)
    if (!existsSync(base)) return null
    const versions = readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.includes('.tmp-') && existsSync(join(base, d.name, 'manifest.json')))
      .map((d) => d.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    return versions[0] ? { slug, version: versions[0], dir: join(base, versions[0]) } : null
  }

  private async applyAll(): Promise<void> {
    await Promise.all([...this.sessions].map((s) => this.applyTo(s)))
    this.cleanup()
  }

  /** Deixa a sessão com exatamente as extensões instaladas (troca versões antigas, tira as removidas). */
  private async applyTo(ses: Session): Promise<void> {
    const want = new Set([...this.installed.values()].map((i) => resolve(i.dir)))
    const root = resolve(this.root)
    const loaded = ses.extensions.getAllExtensions()
    for (const ext of loaded) {
      const p = resolve(ext.path)
      if (p.startsWith(root + sep) && !want.has(p)) ses.extensions.removeExtension(ext.id)
    }
    const have = new Set(loaded.map((e) => resolve(e.path)))
    for (const dir of want) {
      if (have.has(dir)) continue
      try {
        await ses.extensions.loadExtension(dir)
      } catch (err) {
        this.log.warn(null, `Não consegui carregar a extensão em ${dir}: ${(err as Error).message}`)
      }
    }
  }

  /** Apaga versões antigas e extensões tiradas da lista. */
  private cleanup(): void {
    if (!existsSync(this.root)) return
    const keep = new Set([...this.installed.values()].map((i) => resolve(i.dir)))
    const wanted = new Set(this.wanted())
    for (const slug of readdirSync(this.root)) {
      const base = join(this.root, slug)
      try {
        if (!wanted.has(slug)) {
          rmSync(base, { recursive: true, force: true })
          continue
        }
        for (const v of readdirSync(base)) {
          const dir = resolve(base, v)
          if (!keep.has(dir) && !v.includes('.tmp-')) rmSync(dir, { recursive: true, force: true })
        }
      } catch {
        /* arquivo em uso: tenta de novo na próxima */
      }
    }
  }
}
