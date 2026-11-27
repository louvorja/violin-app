#!/usr/bin/env node
/**
 * Gera as curvas `linear()` de `--lj-ease-spring` e `--lj-ease-spring-bounce`
 * (src/assets/styles/tokens.css, seção 15).
 *
 * O CSS não tem mola nativa: `linear()` recebe os pontos de uma curva qualquer,
 * e aqui eles saem da resposta ao degrau de uma mola amortecida. Assim a
 * animação continua sendo uma transição comum, que roda no compositor — nenhuma
 * biblioteca, nenhum JavaScript por quadro.
 *
 *   node scripts/spring-curves.mjs
 *
 * Para mudar o caráter das molas, mexa em SPRINGS, rode de novo e cole o
 * resultado no tokens.css.
 *
 * - damping: 1 chega sem passar do alvo; abaixo de 1 passa e volta.
 * - frequency: quanto do tempo declarado a mola gasta chegando. Maior = chega
 *   antes e passa mais tempo quase parada na cauda.
 * - points: resolução da curva. Menos de ~20 começa a aparecer facetado.
 */
const SPRINGS = [
  { name: "--lj-ease-spring", damping: 1, frequency: 9, points: 24 },
  { name: "--lj-ease-spring-bounce", damping: 0.7, frequency: 9, points: 26 },
];

function stepResponse({ damping, frequency, points }) {
  const curve = [];
  for (let i = 0; i <= points; i++) {
    const t = i / points;
    if (damping >= 1) {
      curve.push(1 - (1 + frequency * t) * Math.exp(-frequency * t));
    } else {
      const damped = frequency * Math.sqrt(1 - damping * damping);
      const envelope = Math.exp(-damping * frequency * t);
      const phase = damping / Math.sqrt(1 - damping * damping);
      curve.push(1 - envelope * (Math.cos(damped * t) + phase * Math.sin(damped * t)));
    }
  }
  // A mola real só chega ao alvo no infinito; a transição precisa terminar nele.
  curve[points] = 1;
  return curve;
}

for (const spring of SPRINGS) {
  const curve = stepResponse(spring);
  const last = curve.length - 1;
  const reaches95At = curve.findIndex((value) => value >= 0.95) / last;
  const peak = Math.max(...curve);
  console.log(
    `/* 95% do percurso em ${(reaches95At * 100).toFixed(0)}% do tempo; pico ${peak.toFixed(3)} */`
  );
  console.log(`${spring.name}: linear(${curve.map((value) => +value.toFixed(3)).join(", ")});\n`);
}
