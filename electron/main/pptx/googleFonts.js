'use strict';
/**
 * Fonte de download de fontes:
 *   • GoogleFontsSource   — catálogo gratuito do Google Fonts (sem chave de API)
 *
 * Cada fonte implementa:  async find(typeface) → [{ url, fileName, headers? }]  (vazio = não achou)
 * O download e a instalação ficam no FontService.
 */
const fs = require('fs/promises');
const path = require('path');
const { norm, splitStyle, WEIGHTS } = require('./fontNames.js');

// ── Google Fonts ────────────────────────────────────────────────────────────
class GoogleFontsSource {
  constructor({ fetch, cacheDir }) {
    this.label = 'Google Fonts';
    this.id = 'google';
    this.fetch = fetch;
    this.metaFile = path.join(cacheDir, 'google-fonts-metadata.json');
    this.catalog = null; // Map norm(family) → { family, variants: ["400","700i",...] }
  }

  async _loadCatalog() {
    if (this.catalog) return this.catalog;
    // Sem internet: não tenta de novo para cada fonte do arquivo (cada tentativa espera o tempo limite)
    if (this.failedAt && Date.now() - this.failedAt < 5 * 60 * 1000) throw new Error('Google Fonts indisponível');
    try {
      return await this._fetchCatalog();
    } catch (e) {
      this.failedAt = Date.now();
      throw e;
    }
  }

  async _fetchCatalog() {
    let list = null;
    try {
      const st = await fs.stat(this.metaFile);
      if (Date.now() - st.mtimeMs < 7 * 24 * 3600 * 1000) {
        list = JSON.parse(await fs.readFile(this.metaFile, 'utf8'));
      }
    } catch { /* sem cache */ }

    if (!list) {
      const res = await this.fetch('https://fonts.google.com/metadata/fonts');
      if (!res.ok) throw new Error(`Google Fonts respondeu ${res.status}`);
      let text = await res.text();
      text = text.replace(/^\)\]\}'\s*/, '');
      const json = JSON.parse(text);
      list = (json.familyMetadataList || []).map(f => ({
        family: f.family,
        variants: Object.keys(f.fonts || {}),
      }));
      await fs.mkdir(path.dirname(this.metaFile), { recursive: true });
      await fs.writeFile(this.metaFile, JSON.stringify(list));
    }
    this.catalog = new Map(list.map(f => [norm(f.family), f]));
    return this.catalog;
  }

  /** "Montserrat Black" → família "Montserrat" do catálogo */
  async _match(typeface) {
    const cat = await this._loadCatalog();
    const direct = cat.get(norm(typeface));
    if (direct) return direct;
    const { base } = splitStyle(typeface);
    return cat.get(norm(base)) || null;
  }

  async find(typeface) {
    const fam = await this._match(typeface);
    if (!fam) return [];
    // API CSS v1: com um user-agent "antigo" o Google entrega arquivos .ttf completos.
    const variants = fam.variants.length ? fam.variants : ['400'];
    const spec = variants.map(v => v.endsWith('i') ? `${v.slice(0, -1)}italic` : v).join(',');
    const url = `https://fonts.googleapis.com/css?family=${encodeURIComponent(fam.family)}:${spec}`;
    const res = await this.fetch(url, { headers: { 'User-Agent': 'Mozilla/4.0 (compatible; LouvorJA)' } });
    if (!res.ok) return [];
    const css = await res.text();
    const out = [];
    const blockRe = /@font-face\s*{([^}]*)}/g;
    let b;
    while ((b = blockRe.exec(css))) {
      const block = b[1];
      const src = /url\(([^)]+)\)\s*format\(['"]?truetype/.exec(block) || /url\(([^)]+\.ttf)\)/.exec(block);
      if (!src) continue;
      const weight = (/font-weight:\s*(\d+)/.exec(block) || [])[1] || '400';
      const italic = /font-style:\s*italic/.test(block);
      out.push({
        url: src[1].replace(/['"]/g, ''),
        fileName: `LJ-${fam.family.replace(/\s+/g, '')}-${weight}${italic ? 'i' : ''}.ttf`,
        // o Google entrega alguns pesos com nome interno genérico → renomeamos para o PowerPoint achar
        rename: { family: fam.family, weight: Number(weight), italic },
      });
    }
    return out;
  }
}

module.exports = { GoogleFontsSource, WEIGHTS };
