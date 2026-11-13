// Deck Perf — limita os quadros de animação (requestAnimationFrame) das contas fora de foco.
//
// O jogo desenha num canvas 2D com loops de requestAnimationFrame rodando o tempo todo, mesmo na conta
// que ninguém está olhando. Com um limite (ex.: 10 FPS), cada loop espera o intervalo antes de pedir o
// próximo quadro: menos CPU no processo da página e menos trabalho para a GPU. O jogo em si roda no
// servidor e a automação não depende de quadros, então nada muda no resultado.
//
// O PokeDeck chama `window.__deckPerf.setFps(n)` (0 = sem limite) quando a conta selecionada muda.
(function () {
  'use strict';
  if (window.__deckPerf) return;

  const nativeRaf = window.requestAnimationFrame.bind(window);
  const nativeCaf = window.cancelAnimationFrame.bind(window);
  const agora = () => performance.now();

  let intervalo = 0; // ms entre quadros liberados (0 = sem limite)
  let ultimo = -Infinity; // quando o último quadro foi liberado
  let seq = 0;
  const pendentes = new Map(); // nosso id → { raf } ou { timer }

  function pedirQuadro(id, cb) {
    pendentes.set(id, {
      raf: nativeRaf((t) => {
        pendentes.delete(id);
        ultimo = Math.max(ultimo, agora());
        cb(t);
      }),
    });
  }

  window.requestAnimationFrame = function requestAnimationFrame(cb) {
    const id = ++seq;
    const espera = intervalo ? intervalo - (agora() - ultimo) : 0;
    // Dentro do intervalo: espera com um timer (sem acordar o compositor a cada vsync).
    if (espera > 1) pendentes.set(id, { timer: setTimeout(() => pedirQuadro(id, cb), espera) });
    else pedirQuadro(id, cb);
    return id;
  };

  window.cancelAnimationFrame = function cancelAnimationFrame(id) {
    const p = pendentes.get(id);
    if (!p) return;
    if (p.raf != null) nativeCaf(p.raf);
    if (p.timer != null) clearTimeout(p.timer);
    pendentes.delete(id);
  };

  window.__deckPerf = {
    setFps(fps) {
      const n = Number(fps);
      intervalo = n > 0 ? 1000 / n : 0;
    },
    getFps: () => (intervalo ? Math.round(1000 / intervalo) : 0),
  };
})();
