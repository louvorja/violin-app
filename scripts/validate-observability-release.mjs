const required = ["POSTHOG_API_KEY", "POSTHOG_PROJECT_ID"];
const requiredBuild = process.env.REQUIRE_POSTHOG_SOURCEMAPS === "true";
const isGitHubRelease = typeof process.env.GITHUB_REF_NAME === "string" && process.env.GITHUB_REF_NAME.startsWith("v");

if (!requiredBuild && !isGitHubRelease) {
  console.log("Source maps do PostHog não são obrigatórios fora de uma release/publicação.");
  process.exit(0);
}

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Credenciais de source maps do PostHog ausentes: ${missing.join(", ")}.`);
  console.error("Configure POSTHOG_API_KEY e POSTHOG_PROJECT_ID antes de publicar uma build observável.");
  process.exit(1);
}

console.log(`Source maps do PostHog habilitados para ${process.env.GITHUB_REF_NAME || "publicação web"}.`);
