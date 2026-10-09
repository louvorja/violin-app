/**
 * Regenerate the browser, PWA and desktop icons from src/assets/img/logo.svg.
 * Use --desktop-only when the public assets are already current.
 * Requires the project's Playwright browser. macOS additionally needs iconutil.
 */
import { chromium } from "playwright";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAYERED_ICON, LOGO_WITH_DEPTH, logoWithDepth, macIconLayers } from "./brand-layers.mjs";

const source = readFileSync("src/assets/img/logo.svg", "utf8");
const desktopOnly = process.argv.includes("--desktop-only");
const artwork = source.match(/<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/);
const viewBox = artwork?.[1].match(/\bviewBox="([^"]+)"/)?.[1];
const style = artwork?.[1].match(/\bstyle="([^"]+)"/)?.[1] || "";
if (!artwork || !viewBox) throw new Error("O SVG do logo precisa ter um viewBox.");
const sourceHash = createHash("sha256").update(source).digest("hex");
const manifestPath = "build/brand-assets.json";
/** @type {{ mac?: { source: string, files: Record<string, string> } }} */
const previousManifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : {};

if (!desktopOnly) {
  writeFileSync("public/logo.svg", source);
  writeFileSync("public/ico/favicon.svg", source);
}

// Electron expects a flattened .icns, so this SVG composes the macOS-only
// plate around the complete, editable artwork, including its groups and clips.
// The square canvas has a transparent margin for older macOS Dock versions.
const macSvg = `<!-- brand-source-sha256: ${sourceHash} -->
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="plate" x1=".05" y1="0" x2=".95" y2="1" gradientUnits="objectBoundingBox">
      <stop stop-color="#FFFFFF"/><stop offset=".20" stop-color="#FBFEFF"/>
      <stop offset=".68" stop-color="#F3F9FE"/><stop offset="1" stop-color="#E5F1F9"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2=".85" y2="1">
      <stop stop-color="#FFFFFF" stop-opacity=".76"/>
      <stop offset=".36" stop-color="#FFFFFF" stop-opacity=".10"/>
      <stop offset=".74" stop-color="#E7F5FF" stop-opacity=".04"/>
      <stop offset="1" stop-color="#BCD9ED" stop-opacity=".22"/>
    </linearGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#FFFFFF" stop-opacity="1"/>
      <stop offset=".42" stop-color="#CAE3F1" stop-opacity=".58"/>
      <stop offset="1" stop-color="#91B8CD" stop-opacity=".82"/>
    </linearGradient>
    <filter id="plateShadow" x="-.15" y="-.15" width="1.3" height="1.4">
      <feGaussianBlur stdDeviation="15"/>
    </filter>
    <filter id="markShadow" x="-.2" y="-.2" width="1.4" height="1.5">
      <feDropShadow dx="0" dy="17" stdDeviation="17" flood-color="#001129" flood-opacity=".65"/>
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#001129" flood-opacity=".32"/>
    </filter>
    <clipPath id="plateClip"><rect x="99" y="99" width="826" height="826" rx="201"/></clipPath>
  </defs>
  <rect x="105" y="116" width="814" height="814" rx="200" fill="#346785" opacity=".28" filter="url(#plateShadow)"/>
  <rect x="99" y="99" width="826" height="826" rx="201" fill="url(#plate)"/>
  <g clip-path="url(#plateClip)">
    <rect x="99" y="99" width="826" height="826" fill="url(#glass)"/>
    <path d="M111 330 C237 90 508 100 723 153 C574 159 412 219 306 342 C235 424 171 501 100 518 Z" fill="#D9EEFA" opacity=".28"/>
    <path d="M111 731 C306 861 655 826 914 619 L925 926 H99 Z" fill="#B9D7E9" opacity=".16"/>
  </g>
  <g filter="url(#markShadow)">
    <svg x="165" y="165" width="694" height="694" viewBox="${viewBox}" style="${style}" overflow="visible">${artwork[2]}</svg>
  </g>
  <rect x="100.5" y="100.5" width="823" height="823" rx="199.5" fill="none" stroke="url(#edge)" stroke-width="3"/>
</svg>`;
writeFileSync("build/icon-mac.svg", macSvg);

// Icon Composer package: layers come from the logo; icon.json (glass, shadows,
// order) is edited by hand or in Icon Composer and stays as is.
const layers = macIconLayers(source, sourceHash);
mkdirSync(`${LAYERED_ICON}/Assets`, { recursive: true });
for (const name of readdirSync(`${LAYERED_ICON}/Assets`)) {
  if (!layers.has(`${LAYERED_ICON}/Assets/${name}`)) rmSync(`${LAYERED_ICON}/Assets/${name}`);
}
for (const [path, svg] of layers) writeFileSync(path, svg);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1024, height: 1024 },
  deviceScaleFactor: 1,
});
async function render(svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}svg{display:block;width:100%;height:100%}</style>${svg}`
  );
  return page.screenshot({ omitBackground: true, animations: "disabled" });
}

// Up to 48px the layer shadows would only blur the drawing, so those stay flat.
const depth = logoWithDepth(source);
writeFileSync(LOGO_WITH_DEPTH, depth);

const pngs = new Map();
for (const size of [16, 32, 48, 144, 152, 180, 192, 256, 512, 1200]) {
  pngs.set(size, await render(size <= 48 ? source : depth, size));
}
if (!desktopOnly) {
  for (const size of [16, 32, 144, 152, 180, 192, 512]) {
    writeFileSync(`public/ico/favicon-${size}x${size}.png`, pngs.get(size));
  }
  writeFileSync("public/ico/favicon.png", pngs.get(1200));
  writeFileSync("public/logo.png", pngs.get(1200));
}
writeFileSync("build/icon-512.png", pngs.get(512));

// ICO stores PNG entries, which Windows supports from Vista onward.
function ico(sizes) {
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    const png = pngs.get(size);
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...sizes.map((size) => pngs.get(size))]);
}
if (!desktopOnly) writeFileSync("public/favicon.ico", ico([16, 32, 48, 256]));
writeFileSync("build/icon.ico", ico([16, 32, 48, 256]));

if (process.platform === "darwin") {
  const iconset = mkdtempSync(join(tmpdir(), "louvorja-icon-")) + ".iconset";
  // iconutil requires the .iconset extension on the directory itself.
  const { renameSync } = await import("node:fs");
  const tmp = iconset.slice(0, -8);
  renameSync(tmp, iconset);
  // With Icon Composer installed, the static icons (Dock in dev, DMG, older
  // macOS) come from the real Liquid Glass render of the layered icon, placed
  // on Apple's 824/1024 grid. Without it, they fall back to the flat plate.
  const ictool = "/Applications/Icon Composer.app/Contents/Executables/ictool";
  const glassDir = mkdtempSync(join(tmpdir(), "louvorja-glass-"));
  try {
    let glass = null;
    if (existsSync(ictool)) {
      const out = join(glassDir, "glass.png");
      execFileSync(ictool, [
        LAYERED_ICON,
        "--export-image",
        "--output-file",
        out,
        "--platform",
        "macOS",
        "--rendition",
        "Default",
        "--width",
        "1648",
        "--height",
        "1648",
        "--scale",
        "1",
      ]);
      glass = readFileSync(out).toString("base64");
    }
    const renderMac = (size) => {
      if (!glass) return render(macSvg, size);
      const inset = (size * 100) / 1024;
      const side = (size * 824) / 1024;
      return render(
        `<img src="data:image/png;base64,${glass}" style="position:absolute;left:${inset}px;top:${inset}px;width:${side}px;height:${side}px">`,
        size
      );
    };
    const sizes = [16, 32, 64, 128, 256, 512, 1024];
    const rendered = new Map();
    for (const size of sizes) rendered.set(size, await renderMac(size));
    writeFileSync("build/icon-mac.png", rendered.get(1024));
    for (const size of [16, 32, 128, 256, 512]) {
      writeFileSync(join(iconset, `icon_${size}x${size}.png`), rendered.get(size));
      writeFileSync(join(iconset, `icon_${size}x${size}@2x.png`), rendered.get(size * 2));
    }
    // Both 16/32 and their Retina variants matter for Finder and the Dock.
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", "build/icon-mac.icns"]);
  } finally {
    rmSync(iconset, { recursive: true, force: true });
    rmSync(glassDir, { recursive: true, force: true });
  }
}
await browser.close();
const checksum = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const desktopFiles = ["build/icon-512.png", "build/icon.ico"];
const macFiles = ["build/icon-mac.svg", "build/icon-mac.png", "build/icon-mac.icns"];
const manifest = {
  source: sourceHash,
  desktop: Object.fromEntries(desktopFiles.map((path) => [path, checksum(path)])),
  mac:
    process.platform === "darwin"
      ? {
          source: sourceHash,
          files: Object.fromEntries(macFiles.map((path) => [path, checksum(path)])),
        }
      : previousManifest.mac || null,
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  process.platform === "darwin"
    ? desktopOnly
      ? "Ícones desktop de Windows, Linux e macOS gerados."
      : "Logo, PWA, Windows, Linux e macOS: assets gerados."
    : "Logo e ícones de Windows/Linux gerados; macOS requer iconutil."
);
