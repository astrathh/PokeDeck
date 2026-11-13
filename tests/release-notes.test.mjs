// Testes do gerador de descrição das Releases (scripts/release-notes.mjs).
import assert from 'node:assert/strict'
import { classificar, montarNotas } from '../scripts/release-notes.mjs'

let ok = 0
const caso = (nome, fn) => { fn(); ok++; console.log('ok -', nome) }

caso('agrupa por tipo e capitaliza', () => {
  assert.deepEqual(classificar('feat: nova tela de contas'), { grupo: 'feat', texto: 'Nova tela de contas' })
  assert.deepEqual(classificar('fix(auto): poção certa'), { grupo: 'fix', texto: 'Poção certa' })
  assert.deepEqual(classificar('perf: menos RAM'), { grupo: 'perf', texto: 'Menos RAM' })
  assert.deepEqual(classificar('revert: tira X'), { grupo: 'outros', texto: 'Tira X' })
  assert.deepEqual(classificar('Ajusta o layout'), { grupo: 'outros', texto: 'Ajusta o layout' })
})

caso('deixa de fora versão, merge e commits internos', () => {
  for (const s of ['0.1.4', 'v1.2.0', 'Merge branch x', 'ci: node 24', 'chore: deps', 'docs: readme', 'fix(release): rascunho']) {
    assert.equal(classificar(s), null, s)
  }
})

caso('monta as seções na ordem e sem repetir', () => {
  const md = montarNotas(['fix: b', 'feat: a', 'feat: a', '0.1.4', 'perf: c'], 'v0.1.4')
  assert.ok(md.indexOf('### Novidades') < md.indexOf('### Correções'))
  assert.ok(md.indexOf('### Correções') < md.indexOf('### Desempenho'))
  assert.equal(md.match(/- A\n/g).length, 1)
  assert.match(md, /PokeDeck-Setup-0\.1\.4\.exe/)
})

caso('só commits internos: diz que não há mudança visível', () => {
  assert.match(montarNotas(['ci: x', '0.1.5'], 'v0.1.5'), /Ajustes internos/)
})

console.log(`\n${ok} casos passaram`)
