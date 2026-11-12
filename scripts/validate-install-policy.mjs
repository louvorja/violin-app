import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const FORBIDDEN_ROOT_HOOKS = Object.freeze([
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "preprepare",
  "postprepare",
]);

export const ALLOWED_INSTALL_SCRIPT_PACKAGES = Object.freeze([
  "node_modules/@floating-ui/vue/node_modules/vue-demi",
  "node_modules/@parcel/watcher",
  "node_modules/@percy/core",
  "node_modules/@posthog/cli",
  "node_modules/core-js",
  "node_modules/electron",
  "node_modules/electron-winstaller",
  "node_modules/esbuild",
  "node_modules/fsevents",
  "node_modules/protobufjs",
]);

const allowedInstallScripts = new Set(ALLOWED_INSTALL_SCRIPT_PACKAGES);
const integrityPattern = /^sha(?:1|256|384|512)-[A-Za-z0-9+/]+={0,2}$/;

function readJson(root, relativePath, errors) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    errors.push(`${relativePath} ausente.`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch {
    errors.push(`${relativePath} não contém JSON válido.`);
    return null;
  }
}

function validateRootScripts(label, scripts, errors) {
  if (!scripts || typeof scripts !== "object") return;
  for (const hook of FORBIDDEN_ROOT_HOOKS) {
    if (Object.hasOwn(scripts, hook)) {
      errors.push(`${label} não pode declarar o gancho automático "${hook}".`);
    }
  }
  if (Object.hasOwn(scripts, "prepare") && scripts.prepare !== "husky") {
    errors.push(`${label} só pode declarar "prepare": "husky" (encontrado: ${JSON.stringify(scripts.prepare)}).`);
  }
}

function validateRootFiles(root, errors) {
  let entries = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    errors.push("Não foi possível listar a raiz do repositório.");
    return;
  }
  for (const name of entries) {
    if (/^\.ci/i.test(name) || /\.sh$/i.test(name)) {
      errors.push(`Arquivo de script não permitido na raiz do repositório: ${name}`);
    }
  }

  const huskyDir = path.join(root, ".husky");
  if (fs.existsSync(huskyDir)) {
    for (const entry of fs.readdirSync(huskyDir, { withFileTypes: true })) {
      if (entry.name === "_" || entry.name.startsWith(".")) continue;
      if (entry.name !== "pre-commit" || !entry.isFile()) {
        errors.push(`Hook Git inesperado em .husky/${entry.name}`);
        continue;
      }
      const content = fs.readFileSync(path.join(huskyDir, entry.name), "utf8").trim();
      if (content !== "npx lint-staged") {
        errors.push(`.husky/pre-commit contém comando inesperado: ${JSON.stringify(content)}`);
      }
    }
  }
}

export function validateInstallPolicy(root = defaultRoot) {
  const errors = [];
  validateRootFiles(root, errors);

  const pkg = readJson(root, "package.json", errors);
  const lock = readJson(root, "package-lock.json", errors);
  if (!pkg || !lock) return errors;

  validateRootScripts("package.json", pkg.scripts, errors);
  validateRootScripts("package-lock.json (raiz)", lock.packages?.[""]?.scripts, errors);

  const packages = lock.packages;
  if (!packages || typeof packages !== "object") {
    errors.push("package-lock.json não contém o mapa 'packages'.");
    return errors;
  }

  const dependencyEntries = Object.entries(packages).filter(([pkgPath, meta]) => pkgPath !== "" && !meta?.link);
  if (dependencyEntries.length === 0) {
    errors.push("package-lock.json não contém pacotes resolvidos.");
    return errors;
  }

  for (const [pkgPath, meta] of dependencyEntries) {
    if (meta?.scripts) {
      errors.push(`${pkgPath} não deve expor scripts inline no package-lock.json.`);
    }
    if (meta?.hasInstallScript && !allowedInstallScripts.has(pkgPath)) {
      errors.push(`${pkgPath} declara hasInstallScript fora da lista permitida.`);
    }

    if (typeof meta?.resolved !== "string") {
      errors.push(`${pkgPath} está sem URL 'resolved' no package-lock.json.`);
      continue;
    }

    let url;
    try {
      url = new URL(meta.resolved);
    } catch {
      errors.push(`${pkgPath} possui URL 'resolved' inválida: ${meta.resolved}`);
      continue;
    }

    if (url.origin !== "https://registry.npmjs.org") {
      errors.push(`${pkgPath} resolve fora de https://registry.npmjs.org (${url.origin}).`);
    }
    if (url.username || url.password) {
      errors.push(`${pkgPath} contém credenciais na URL 'resolved'.`);
    }
    if (!url.pathname.endsWith(".tgz")) {
      errors.push(`${pkgPath} não aponta para um tarball .tgz (${url.pathname}).`);
    }
    if (!integrityPattern.test(meta?.integrity ?? "")) {
      errors.push(`${pkgPath} possui hash 'integrity' ausente ou inválido.`);
    }
  }

  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const errors = validateInstallPolicy();
  if (errors.length > 0) {
    console.error("Política de instalação npm violada:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log("Política de instalação npm conferida.");
}
