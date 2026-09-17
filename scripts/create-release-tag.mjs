import fs from "node:fs";
import { execFileSync } from "node:child_process";

const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
const tag = `v${version}`;

execFileSync("git", ["tag", "-a", tag, "-m", `LouvorJA Violin ${version}`], {
  stdio: "inherit",
});
console.log(`Tag anotada criada: ${tag}. Faça o push somente depois da revisão.`);
