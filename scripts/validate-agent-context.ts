import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(scriptDirectory, "..");

function readText(root: string, relativePath: string, errors: string[]): string {
  const filePath = join(root, relativePath);
  if (!existsSync(filePath)) {
    errors.push(`${relativePath} is missing.`);
    return "";
  }

  return readFileSync(filePath, "utf8");
}

function requireText(
  content: string,
  file: string,
  expected: string,
  errors: string[],
): void {
  if (!content.includes(expected)) {
    errors.push(`${file} must mention ${JSON.stringify(expected)}.`);
  }
}

/**
 * Ensures the short agent contract agrees with the code paths it directs agents to.
 * Keep this deliberately small: it detects only contradictions that would send an
 * implementation in the wrong direction.
 */
export function validateAgentContext(root = defaultRoot): string[] {
  const errors: string[] = [];
  const agents = readText(root, "AGENTS.md", errors);
  const claude = readText(root, "CLAUDE.md", errors);
  const main = readText(root, "src/main.js", errors);
  const moduleRegistry = readText(root, "src/config/modules/index.ts", errors);
  const packageText = readText(root, "package.json", errors);

  for (const expected of [
    "Pinia 3",
    "manifest.ts",
    "src/types/Module.ts",
    "VITE_*",
    "v-html",
    "saída estruturada validada",
    "npm run validate:agent-context",
  ]) {
    requireText(agents, "AGENTS.md", expected, errors);
  }

  for (const expected of ["AGENTS.md", "**Pinia 3**", "manifest.ts"]) {
    requireText(claude, "CLAUDE.md", expected, errors);
  }
  for (const obsolete of [
    "**Vuex 4**",
    "├── manifest.json",
    "— após D0",
    "**Status**: planejada",
    "Roadmap Desktop (D0–D10)",
  ]) {
    if (claude.includes(obsolete)) {
      errors.push(`CLAUDE.md still contains obsolete context: ${JSON.stringify(obsolete)}.`);
    }
  }

  requireText(main, "src/main.js", "createPinia", errors);
  requireText(moduleRegistry, "src/config/modules/index.ts", "manifest.ts", errors);

  if (packageText) {
    try {
      const packageJson = JSON.parse(packageText) as {
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
      };
      if (!packageJson.devDependencies?.pinia) {
        errors.push("package.json must retain Pinia as a development dependency.");
      }
      for (const script of ["test", "typecheck", "validate:manifests", "validate:agent-context"]) {
        if (!packageJson.scripts?.[script]) {
          errors.push(`package.json is missing the ${JSON.stringify(script)} script.`);
        }
      }
    } catch {
      errors.push("package.json is not valid JSON.");
    }
  }

  return errors;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const errors = validateAgentContext();
  if (errors.length) {
    console.error("Agent-context validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Agent-context validation passed.");
  }
}
