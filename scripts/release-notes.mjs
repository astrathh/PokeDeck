// Gera a descrição da Release a partir dos commits desde a última versão publicada.
//
//   node scripts/release-notes.mjs <tag-anterior> <tag-nova>   → escreve o Markdown na saída padrão
//   (sem tag anterior: usa todos os commits até a nova)
//
// Agrupa pelo prefixo do commit (Conventional Commits): feat → Novidades, fix → Correções,
// perf → Desempenho; o resto vai para "Outras mudanças". Commits internos (ci, chore, docs, test,
// build, escopo "release") e os de versão do `npm version` ("0.1.4") ficam de fora.
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const GRUPOS = [
  ['feat', 'Novidades'],
  ['fix', 'Correções'],
  ['perf', 'Desempenho'],
  ['outros', 'Outras mudanças'],
]
const INTERNOS = new Set(['ci', 'chore', 'docs', 'test', 'build', 'style'])

/** Uma linha de assunto de commit → { grupo, texto } ou null (fica de fora). */
export function classificar(assunto) {
  const s = assunto.trim()
  if (!s || /^v?\d+\.\d+\.\d+(-[\w.]+)?$/.test(s)) return null // commit do npm version
  if (/^Merge /.test(s)) return null
  const m = s.match(/^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/)
  if (!m) return { grupo: 'outros', texto: s }
  const [, tipo, escopo, texto] = m
  const t = tipo.toLowerCase()
  if (INTERNOS.has(t) || escopo?.toLowerCase() === 'release') return null
  const grupo = t === 'feat' || t === 'fix' || t === 'perf' ? t : 'outros'
  return { grupo, texto: texto.charAt(0).toUpperCase() + texto.slice(1) }
}

export function montarNotas(assuntos, versao) {
  const porGrupo = new Map(GRUPOS.map(([g]) => [g, []]))
  for (const a of assuntos) {
    const c = classificar(a)
    if (c && !porGrupo.get(c.grupo).includes(c.texto)) porGrupo.get(c.grupo).push(c.texto)
  }
  const partes = []
  for (const [g, titulo] of GRUPOS) {
    const itens = porGrupo.get(g)
    if (itens.length) partes.push(`### ${titulo}\n\n${itens.map((i) => `- ${i}`).join('\n')}`)
  }
  if (!partes.length) partes.push('Ajustes internos, sem mudança visível.')
  partes.push(
    [
      '---',
      `**Já tem o PokeDeck instalado?** A atualização para a ${versao} chega sozinha: aparece` +
        ' "reiniciar e atualizar" na barra de status (ou instala ao fechar).',
      '',
      `**Primeira vez?** Baixe o \`PokeDeck-Setup-${versao.replace(/^v/, '')}.exe\` abaixo. O Windows avisa que o app` +
        ' não tem assinatura: clique em **Mais informações → Executar assim mesmo**.',
    ].join('\n')
  )
  return partes.join('\n\n') + '\n'
}

function main() {
  const [anterior, nova] = process.argv.slice(2)
  if (!nova) {
    console.error('uso: node scripts/release-notes.mjs <tag-anterior|""> <tag-nova>')
    process.exit(2)
  }
  const faixa = anterior ? `${anterior}..${nova}` : nova
  const log = execFileSync('git', ['log', '--no-merges', '--format=%s', faixa], { encoding: 'utf8' })
  process.stdout.write(montarNotas(log.split('\n').filter(Boolean), nova))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
