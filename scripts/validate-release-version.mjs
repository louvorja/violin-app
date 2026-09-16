import fs from "node:fs";

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const version = packageJson.version;
const lockVersions = [packageLock.packages?.[""].version];
const errors = [];

if (!version || lockVersions.some((lockVersion) => lockVersion !== version)) {
  errors.push(
    `package.json (${version || "sem versão"}) e package-lock.json (${lockVersions.join(", ")}) precisam ter a mesma versão.`
  );
}

const refName = process.env.GITHUB_REF_NAME;
if (refName?.startsWith("v") && refName.slice(1) !== version) {
  errors.push(`A tag ${refName} não corresponde à versão ${version}.`);
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

console.log(`Versão conferida: ${version}`);
