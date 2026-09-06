/**
 * Lança o Electron em desenvolvimento com os argumentos que cada sistema exige.
 *
 * Existe por causa do Linux. Numa árvore recém-clonada, o `chrome-sandbox` que
 * vem dentro de `node_modules/electron/dist` está com modo 0755, e o Chromium
 * aborta a inicialização com "The SUID sandbox helper binary was found, but is
 * not configured correctly" antes de abrir qualquer janela.
 *
 * O `appendSwitch("no-sandbox")` que o `main.cjs` já faz para Linux não cobre
 * esse caso: quando esse código roda, o bootstrap do Chromium já decidiu usar o
 * sandbox SUID. A decisão só muda com a flag vinda de fora, na linha de comando
 * — medido no Ubuntu 24.04, onde sem ela o processo morre com SIGTRAP e com ela
 * o app abre normalmente.
 *
 * A alternativa seria mandar cada pessoa rodar `sudo chown root` e `chmod 4755`
 * no binário depois de todo `npm install`, o que é pior. Em produção nada disso
 * é preciso: o electron-builder gera o pacote com o sandbox já resolvido.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electron = require("electron");

const args = ["."];
if (process.platform === "linux") {
  args.push("--no-sandbox");
  // Mesma razão do `executableArgs` no electron-builder.yml: sob Wayland a
  // projeção abre no monitor errado, e a plataforma gráfica é escolhida antes
  // de o `main.cjs` rodar. Aqui é o equivalente do atalho .desktop.
  args.push("--ozone-platform=x11");
}

const env = { ...process.env, ELECTRON_DEV: "1" };

// Herdada, essa variável faz o binário do Electron rodar como Node puro: o
// `main.cjs` é avaliado, mas `require("electron").app` vem indefinido e o boot
// quebra no primeiro acesso. Ferramentas que rodam dentro do Electron — o VS
// Code é uma — a definem para os processos que lançam, e o wrapper oficial do
// pacote não a remove.
delete env.ELECTRON_RUN_AS_NODE;

const filho = spawn(electron, args, { stdio: "inherit", env });

// Sem isto o Ctrl+C encerra este processo e deixa a janela do Electron órfã,
// e o `concurrently -k` do script de dev não consegue derrubar o par.
for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, () => filho.kill(sinal));
}

filho.on("exit", (codigo, sinal) => {
  process.exit(sinal ? 1 : (codigo ?? 0));
});
