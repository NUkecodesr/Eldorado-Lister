// Brainrot pictures from the Steal a Brainrot wiki (stealabrainrot.fandom.com, Brainrots
// page). The page lists every brainrot as an image whose alt text is its name; the map
// name -> image URL is refreshed once a day, each picture is downloaded once and cached.
const fs = require('fs');
const path = require('path');

const API = 'https://stealabrainrot.fandom.com/api.php?action=parse&page=Brainrots&prop=text&format=json&formatversion=2';
// an honest client name: the wiki's image CDN answers 403 to a browser user agent that does not
// come from a real browser
const UA = 'ZotacLister/1.0 (brainrot listing images)';
const DAY = 24 * 3600 * 1000;
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

class Wiki {
  // bundled: a copy of the index shipped with the app (used when the wiki can't be reached);
  // fetch: Electron's net.fetch (Chromium's network stack) when available
  constructor({ dir, log, bundled, fetch: fetchImpl }) {
    this.bundled = bundled;
    this.fetch = fetchImpl || ((...a) => fetch(...a));
    this.dir = path.join(dir, 'wiki');
    fs.mkdirSync(this.dir, { recursive: true });
    this.mapFile = path.join(this.dir, 'map.json');
    this.log = log || (() => {});
    this.map = null; this.loading = null; this.inflight = new Map();
  }

  // name (normalised) -> full-size image URL
  async index() {
    if (this.map) return this.map;
    try {
      const st = fs.statSync(this.mapFile);
      if (Date.now() - st.mtimeMs < DAY) return (this.map = JSON.parse(fs.readFileSync(this.mapFile, 'utf8')));
    } catch { /* no cache yet */ }
    if (!this.loading) this.loading = this.fetchIndex().finally(() => { this.loading = null; });
    return this.loading;
  }

  async fetchIndex() {
    try {
      const r = await this.fetch(API, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('wiki HTTP ' + r.status);
      const html = (await r.json()).parse.text;
      const map = {};
      // the link around each picture carries the real name (alt text is sometimes a nickname
      // like "Garamadundung" or "Default Globa Steppa")
      for (const m of html.matchAll(/(?:<a\b[^>]*\btitle="([^"]*)"[^>]*>\s*)?(<img\b[^>]*>)/g)) {
        const tag = m[2];
        const alt = m[1] || (tag.match(/\balt="([^"]*)"/) || [])[1];
        const src = (tag.match(/\bdata-src="([^"]*)"/) || tag.match(/\bsrc="(https:[^"]*)"/) || [])[1];
        const file = (tag.match(/\bdata-image-name="([^"]*)"/) || [])[1] || '';
        if (!alt || !src || /^Indicator-/i.test(file)) continue;
        const key = norm(decodeHtml(alt));
        if (!key || map[key]) continue;   // first picture per brainrot (the main one)
        map[key] = src.replace(/&amp;/g, '&').replace(/\/scale-to-width-down\/\d+/, '');
      }
      if (Object.keys(map).length < 20) throw new Error('wiki page had no brainrot list');
      fs.writeFileSync(this.mapFile, JSON.stringify(map));
      this.log('info', `[Wiki] ${Object.keys(map).length} brainrot pictures indexed`);
      return (this.map = map);
    } catch (e) {
      this.log('warn', '[Wiki] ' + e.message + ' - using the saved picture list');
      // an older download, else the list shipped with the app; never keep an empty list for good
      for (const f of [this.mapFile, this.bundled]) {
        try { const m = JSON.parse(fs.readFileSync(f, 'utf8')); if (Object.keys(m).length >= 20) return (this.map = m); } catch { /* next */ }
      }
      return {};
    }
  }

  // data: URL of the brainrot's wiki picture, or null when the wiki has none
  async picture(name) {
    const key = norm(name);
    // 1024 px copies (cards are 1200 px now); an older 512 px copy is the fallback
    const f = path.join(this.dir, key + '@1024.png'), old = path.join(this.dir, key + '.png');
    if (fs.existsSync(f)) return dataUrl(fs.readFileSync(f));
    const url = (await this.index())[key];
    if (!url) return fs.existsSync(old) ? dataUrl(fs.readFileSync(old)) : null;
    if (!this.inflight.has(key)) this.inflight.set(key, this.download(url, f).finally(() => this.inflight.delete(key)));
    if (await this.inflight.get(key)) return dataUrl(fs.readFileSync(f));
    return fs.existsSync(old) ? dataUrl(fs.readFileSync(old)) : null;
  }

  async download(url, file) {
    // a 1024px copy (the originals are up to 3 MB each, which made card generation time out);
    // format=original keeps it a PNG instead of WebP. Falls back to the full-size file.
    const scaled = url.replace(/\/revision\/latest(?!\/scale)/, '/revision/latest/scale-to-width-down/1024');
    for (const u of [...new Set([scaled, url])]) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await this.fetch(u + (u.includes('?') ? '&' : '?') + 'format=original', { headers: { 'User-Agent': UA, Accept: 'image/png,image/*' }, signal: AbortSignal.timeout(20000) });
          if (!r.ok) break;
          const buf = Buffer.from(await r.arrayBuffer());
          const png = buf[0] === 0x89 && buf[1] === 0x50, jpg = buf[0] === 0xff && buf[1] === 0xd8, webp = buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP';
          if (!png && !jpg && !webp) break;
          fs.writeFileSync(file, buf);
          return true;
        } catch { /* timeout / network: try again */ }
      }
    }
    this.log('warn', '[Wiki] picture download failed: ' + url.split('/images/')[1]);
    return false;
  }
}

function dataUrl(buf) {
  const type = buf[0] === 0xff ? 'image/jpeg' : buf.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : 'image/png';
  return `data:${type};base64,` + buf.toString('base64');
}

function decodeHtml(s) {
  return s.replace(/&amp;/g, '&').replace(/&#39;|&#039;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

module.exports = { Wiki };
