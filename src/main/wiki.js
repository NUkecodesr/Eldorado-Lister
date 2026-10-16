// Brainrot pictures from the Steal a Brainrot wiki (stealabrainrot.fandom.com, Brainrots
// page). The page lists every brainrot as an image whose alt text is its name; the map
// name -> image URL is refreshed once a day, each picture is downloaded once and cached.
const fs = require('fs');
const path = require('path');

const API = 'https://stealabrainrot.fandom.com/api.php?action=parse&page=Brainrots&prop=text&format=json&formatversion=2';
const UA = 'ZotacLister/1.0 (brainrot listing images)';
const DAY = 24 * 3600 * 1000;
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

class Wiki {
  constructor({ dir, log }) {
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
      const r = await fetch(API, { headers: { 'User-Agent': UA } });
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
      this.log('warn', '[Wiki] ' + e.message);
      try { return (this.map = JSON.parse(fs.readFileSync(this.mapFile, 'utf8'))); } catch { return (this.map = {}); }
    }
  }

  // data: URL of the brainrot's wiki picture, or null when the wiki has none
  async picture(name) {
    const key = norm(name);
    const f = path.join(this.dir, key + '.png');
    if (fs.existsSync(f)) return 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
    const url = (await this.index())[key];
    if (!url) return null;
    if (!this.inflight.has(key)) this.inflight.set(key, this.download(url, f).finally(() => this.inflight.delete(key)));
    return (await this.inflight.get(key)) ? 'data:image/png;base64,' + fs.readFileSync(f).toString('base64') : null;
  }

  async download(url, file) {
    try {
      // format=original keeps the uploaded PNG (the CDN otherwise may answer with WebP)
      const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'format=original', { headers: { 'User-Agent': UA, Accept: 'image/png,image/*' } });
      if (!r.ok) return false;
      const buf = Buffer.from(await r.arrayBuffer());
      if (!(buf[0] === 0x89 && buf[1] === 0x50) && !(buf[0] === 0xff && buf[1] === 0xd8)) return false;   // PNG / JPEG only
      fs.writeFileSync(file, buf);
      return true;
    } catch { return false; }
  }
}

function decodeHtml(s) {
  return s.replace(/&amp;/g, '&').replace(/&#39;|&#039;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

module.exports = { Wiki };
