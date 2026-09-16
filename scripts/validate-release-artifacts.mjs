import fs from "node:fs";
import path from "node:path";

const outputDir = path.resolve("dist_electron");
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

if (!fs.existsSync(outputDir)) {
  console.error("dist_electron não existe; o build da release não foi produzido.");
  process.exit(1);
}

const metadataFiles = fs
  .readdirSync(outputDir)
  .filter((name) => /^latest(?:-[^.]+)?\.yml$/.test(name))
  .sort();

if (metadataFiles.length === 0) {
  console.error("Nenhum arquivo latest*.yml foi produzido pelo build.");
  process.exit(1);
}

const missing = [];
let currentMetadataCount = 0;
const currentMetadataFiles = [];
for (const metadataFile of metadataFiles) {
  const content = fs.readFileSync(path.join(outputDir, metadataFile), "utf8");
  const metadataVersion = content.match(/^version:\s*(.+?)\s*$/m)?.[1];
  if (metadataVersion !== packageVersion) {
    console.warn(
      `Ignorando metadado antigo: ${metadataFile} (${metadataVersion || "sem versão"}).`
    );
    continue;
  }
  currentMetadataCount += 1;
  currentMetadataFiles.push(metadataFile);
  const urls = [...content.matchAll(/^\s+-?\s*url:\s*(.+?)\s*$/gm)].map((match) => match[1]);
  const declaredPath = content.match(/^path:\s*(.+?)\s*$/m)?.[1];

  for (const asset of [...urls, declaredPath].filter(Boolean)) {
    const assetPath = path.join(outputDir, asset);
    if (path.basename(assetPath) !== asset || !fs.existsSync(assetPath)) {
      missing.push(`${metadataFile} → ${asset}`);
    }
  }
}

if (currentMetadataCount === 0) {
  console.error(`Nenhum latest*.yml da versão ${packageVersion} foi produzido pelo build.`);
  process.exit(1);
}

if (missing.length > 0) {
  console.error("Os metadados do atualizador apontam para arquivos que não existem:");
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}

console.log(`Metadados de atualização conferidos: ${currentMetadataFiles.join(", ")}`);
