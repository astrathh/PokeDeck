# PokeDeck — navegador multiconta

App desktop (Electron + React + TypeScript) para rodar várias contas do mesmo jogo de navegador lado a lado, cada uma com sessão própria.

## Rodando

Requisitos: Node 20+.

```bash
npm install
npm run dev        # desenvolvimento com hot reload (F12 abre o DevTools da interface)
npm run dist       # gera o instalador em dist/PokeDeck-Setup-<versão>.exe (sem publicar)
```

Na primeira vez, o app pede a URL do jogo. Depois é só clicar em **Adicionar conta** e logar normalmente em cada slot. O login fica salvo.

## Versões e atualização automática

O Deck instalado procura versão nova nas [Releases](https://github.com/astrathh/PokeDeck/releases) ao abrir e a cada 4 h,
baixa em segundo plano e mostra "Deck X pronto: reiniciar e atualizar" na barra de status (se ninguém clicar, instala
ao fechar). A versão em uso aparece no título da janela e na barra de status.

Para publicar uma versão nova:

```bash
npm version patch          # 0.1.0 → 0.1.1 (minor: 0.2.0) — cria o commit e a tag v0.1.1
git push --follow-tags     # o GitHub Actions monta o instalador e cria a Release
```

O fluxo está em `.github/workflows/release.yml` (Windows do GitHub, roda typecheck e testes antes). Quem usa recebe
a atualização sozinho. Primeira instalação: baixar `PokeDeck-Setup-<versão>.exe` da página de Releases; como o
instalador não tem assinatura digital, o Windows avisa ("Mais informações → Executar assim mesmo").

O repositório usa **releases imutáveis** (Release publicada não aceita mais arquivos): por isso o fluxo cria a Release
como rascunho, sobe o instalador e o `latest.yml`, confere e só então publica. Se o passo de montar falhar, sobra um
rascunho (invisível para quem usa): apague-o em Releases e gere a próxima versão.

A **descrição da Release** é gerada dos commits desde a última Release publicada (`scripts/release-notes.mjs`):
`feat:` vira "Novidades", `fix:` "Correções", `perf:` "Desempenho", o resto "Outras mudanças"; `ci:`, `chore:`,
`docs:`, `test:`, `build:` e `fix(release):` ficam de fora. Escreva o assunto do commit pensando em quem usa o app
(ex.: `feat: aviso quando a conta fica sem poção`). Dá para editar a descrição depois na página da Release.

Ícone: `build/icon.svg` (arte original: três cartas em leque) → `build/icon.png` (512×512).

## Desempenho

Configurações → Desempenho:

- **Bloquear rastreadores** (padrão ligado): Facebook Pixel e Google Analytics/Tag Manager não carregam nas contas.
  O Turnstile da Cloudflare nunca é bloqueado.
- Corretor ortográfico desligado (o Electron carregaria um dicionário por conta) e gráfico da interface com no
  máximo 300 pontos.

## Como funciona

- **Uma sessão por conta.** Cada conta é uma `WebContentsView` numa partição `persist:acc-<id>`, com cookies, localStorage e IndexedDB separados. Os dados ficam em `%APPDATA%/deck-multiconta/Partitions/`.
- **Layout.** A interface em React desenha os slots e mede o `<div>` vazio de cada um. O processo principal posiciona a view do jogo exatamente em cima (`src/renderer/src/components/DeckGrid.tsx` → `setBounds`).
- **Modos:** Grade, Colunas, Foco. No **Econômico**, só a conta selecionada é desenhada na tela; as outras continuam rodando (`backgroundThrottling: false`), mas sem gastar GPU.
- **Destacar:** abre a conta numa janela própria. Ao fechar essa janela, a conta volta para a grade sem recarregar.
- **Métricas:** RAM e CPU por conta, a cada 2s, via `app.getAppMetrics()` cruzado com o PID de cada página. O histórico é de 1 hora.

## Gerenciamento automático

Tudo fica em `src/main/accounts.ts`:

| Situação | O que acontece |
|---|---|
| Processo da página caiu | recarrega em 3s |
| Falha de rede ao carregar | tenta de novo com espera crescente (5s, 10s, 20s… até 60s) |
| Página travada além do limite | derruba o processo e recarrega |
| RAM acima do limite configurado | recarrega a conta |
| Texto de desconexão na tela | recarrega a conta |

Recarregamentos entram numa **fila**, com intervalo entre um e outro, para não recarregar tudo de uma vez. Cada conta tem um cooldown de 2 min entre recarregamentos automáticos, para evitar loop.

**Textos de desconexão:** nas Configurações, coloque a frase exata da tela de desconexão do jogo. Evite palavras soltas que podem aparecer no chat.

## Recarregar quando o jogo atualizar

`src/main/updateWatcher.ts` baixa a página do jogo de tempos em tempos e compara uma "impressão digital" da versão:

- **Sem configuração:** usa a lista de arquivos `.js`/`.css` da página. Builds modernos mudam o nome desses arquivos a cada deploy.
- **Com regex/URL de versão:** se o jogo expõe a versão em algum lugar (ex.: um `version.json` ou um texto `v1.7.30` no HTML), configure a URL e uma regex, ex.: `"version":"([^"]+)"`.

Quando a versão muda, o app confere de novo 30s depois e, se confirmar, recarrega todas as contas em fila. Se o log disser que não conseguiu identificar a versão, é porque a página não tem arquivos com hash; aí use a regex.

## Extensões

Nas Configurações → **Extensões**, liste complementos da [addons.mozilla.org](https://addons.mozilla.org) (link ou nome curto), um por linha. Vem com o **/hunt for PokeIdle** (`hunt-for-pokeidle`). O Deck baixa, confere o hash, carrega em todas as contas e procura atualização a cada 6h. Só funcionam extensões que agem dentro da página do jogo (sem popup no ícone). Depois de adicionar ou atualizar, recarregue as contas.

## Limitações conhecidas

- As views do jogo ficam **por cima** do HTML da interface. Por isso, o modal de Configurações esconde as contas enquanto está aberto. Se criar outros popups na UI, chame `window.deck.setOverlay(true)`.
- O zoom da interface é desativado (sem menu), porque mudaria a escala e desalinharia as views.

## Automação (poções e hunts)

Botão **Automação** na barra (regras em Configurações → Automação). Vale para todas as contas e precisa da extensão /hunt for PokeIdle.

- **Poção:** escolhe a de menor preço por HP útil para o pokémon em campo, considerando o limiar de "Usar Poções" do jogo (o que a poção curar além do que falta é desperdício). Antes de comprar, usa o que a conta já tem: deixa marcada em "Usar Poções" só a melhor poção que tem para aquele pokémon (troca sozinha quando muda o pokémon ou a hunt, e marca a próxima na hora quando a ativa acaba). Quando o estoque de todas somadas dura menos de 1h, compra a ideal no NPC, completando 2h. Uma compra nunca passa de 20% do ouro.
- **Hunt:** vai para a de maior XP/h do treinador entre as seguras: o pior golpe do selvagem precisa ser menor que o limiar da poção e, para treinador até nível 200, no máximo 30% do HP. Sempre fica na de maior XP/h — com XP/h praticamente igual (menos de 1% de diferença), fica na de menor golpe; só espera 15 min numa hunt antes de trocar de novo, para não ficar trocando por oscilação da estimativa; se a hunt atual ficou arriscada, sai na hora. A conta deve estar sempre numa hunt: se estiver no Centro (ou sem hunt), vai para a melhor hunt segura em até 1 min; se o jogo recusar a hunt 3 vezes, pula ela por 10 min e tenta a próxima segura. Sem nenhuma hunt segura, fica no Centro. Para trocar, espera a trava de combate do jogo (3 s sem golpe) e escolhe a hunt nova direto (opcional nas Configurações: passar antes pelo Centro Pokémon). Se o jogo recusar 7 vezes, tenta pelo Centro 3 vezes; se ainda assim não der, volta para a hunt de onde saiu; nunca usa "desistir do combate" (perde XP). A saída da hunt acontece no instante em que a trava de combate abre; as outras ações (poções, compras) saem com 2–5 s entre uma e outra.
- **Painel e Eventos:** cada conta mostra as linhas "Hunt:" e "Compra:" com o motivo de trocar/comprar ou não (estoque ok, esperando confirmação, pausada, sem ouro dentro do teto). Quando a automação de uma conta para ou fica esperando algo (sem conexão, sem pokémon…), Eventos registra uma vez, e de novo quando volta a rodar.
- **Contas com automação:** em Configurações → Automação → "Rodar nas contas", ou no botão "Automação" do painel de cada conta. Conta nova entra ligada.
- **Eventos em arquivo:** um arquivo por dia em `%APPDATA%\deck-multiconta\logs\eventos-AAAA-MM-DD.log` (guarda 14 dias).
- **Automação atualizada com o Deck aberto** (desenvolvimento): o Deck percebe que `resources/deck-auto` mudou, recarrega a automação e as contas uma a uma. A versão em uso aparece no painel da conta ("Versão da automação: 0.3.0 · 1a2b3c4").
- **Memória da automação** (última troca de hunt, compra a confirmar, compras pausadas, hunts recusadas, avisos) fica no localStorage de cada conta e sobrevive ao recarregar a página.
- **Gasto real de poção:** a automação mede o HP em poções que some do estoque (últimos 30 min, mesma hunt e pokémon) e usa o maior entre o medido e a estimativa do /hunt para decidir a compra. O painel mostra "Gasto: medido ~N/h · estimado ~M/h".
- **Poção fraca demais:** poção que cura menos que um golpe do selvagem na hunt atual (ex.: Small de 60 HP num pokémon de 19k levando golpes de 2.900) não é marcada, não é comprada, não vira reserva quando a boa acaba e não conta no estoque. Em Eventos aparece como "ignoradas".
- **Conta parada sem aviso:** se a página da conta não está pronta (carregando, caída, sem resposta), Eventos registra "Auto esperando: a página da conta não está pronta…". Página que começou a carregar e não terminou em 3 min é recarregada pelo watchdog; recarregamento pedido pelo próprio jogo também aparece em Eventos.
- Vem **ligada** em todas as contas (é a função principal do PokeDeck). O **modo simulação** (Configurações → Automação) só escreve em Eventos o que faria, sem agir. Vale para instalações novas: quem já salvou configurações mantém o que escolheu.
- Os termos do Pokeidle permitem automação que siga as mesmas regras de quem joga na mão.

## Estrutura

```
src/
  main/         processo principal (janela, contas, watchdog, métricas, atualização)
  preload/      ponte segura window.deck
  renderer/     interface React
  shared/       tipos compartilhados
resources/
  deck-auto/    extensão embutida com a lógica da automação
tests/          testes da automação (npm run test:auto)
```
