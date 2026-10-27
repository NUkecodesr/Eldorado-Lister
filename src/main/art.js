// Pet / trait pictures taken from Steal a Brainrot itself: the scanner sends Roblox asset
// ids (store.art), this downloads them through thumbnails.roblox.com once and caches the
// PNGs in userData/art, so listing images use the real game art.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parseMeshAsync } = require('./rbxmesh');

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

class Art {
  // getCookie(): a stock account's .ROBLOSECURITY (asset downloads need a login);
  // render(payload): draws a 3D model in the renderer and returns a PNG data URL
  constructor({ store, dir, getCookie, render }) {
    this.store = store; this.dir = dir; this.getCookie = getCookie; this.render = render;
    fs.mkdirSync(path.join(dir, 'models'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    if (!store.data.art) store.data.art = { pets: {}, traits: {} };
    if (!store.data.art.mutations) store.data.art.mutations = {};
    this.inflight = new Map();
    this.urls = new Map();   // png path -> { mtime, url }: skips re-reading + re-encoding the same picture
    this.dropSharedPetArt();
  }
  // one picture id used for several different brainrots is a decoration the scanner picked
  // up (e.g. the name-tag ribbon), not brainrot art: forget it and its cached files
  dropSharedPetArt() {
    const pets = this.ids.pets || {};
    const count = {};
    for (const id of Object.values(pets)) count[id] = (count[id] || 0) + 1;
    let n = 0;
    for (const [name, id] of Object.entries(pets)) {
      if (count[id] > 1) { delete pets[name]; try { fs.unlinkSync(this.file('pets', name)); } catch { /* not cached */ } n++; }
    }
    if (n) this.store.save();
    return n;
  }
  get ids() { return this.store.get('art'); }

  // merge ids from a scan ({pets:{name:id}, traits:{name:id}}); returns how many are new
  remember(art) {
    if (!art || typeof art !== 'object') return 0;
    let n = 0;
    // brainrot 3D models from the scanner: key "<name>|<mutation>"; a new model replaces the
    // old picture so it is rendered again
    for (const [key, model] of Object.entries(art.models || {})) {
      if (!model || !Array.isArray(model.parts) || !model.parts.length) continue;
      const mf = path.join(this.dir, 'models', norm(key) + '.json');
      const json = JSON.stringify(model);
      if (fs.existsSync(mf) && fs.readFileSync(mf, 'utf8') === json) continue;
      fs.writeFileSync(mf, json);
      try { fs.unlinkSync(this.file('render1024', key)); } catch { /* not rendered yet */ }
      n++;
    }
    if (art.shape && Object.keys(art.shape).length) { this.ids.shape = art.shape; this.store.save(); }   // entry layouts of misses, for debugging
    for (const kind of ['pets', 'traits', 'mutations']) {
      for (const [name, id] of Object.entries(art[kind] || {})) {
        if (!id || !/^\d+$/.test(String(id))) continue;
        if (!this.ids[kind]) this.ids[kind] = {};
        if (this.ids[kind][name] !== String(id)) { this.ids[kind][name] = String(id); n++; }
      }
    }
    if (n) this.store.save();
    this.dropSharedPetArt();
    this.prefetch('traits'); this.prefetch('mutations');
    return n;
  }

  // fetch every not-yet-cached icon of a kind: thumbnails.roblox.com takes 100 ids per call
  async prefetch(kind) {
    this.prefetching = this.prefetching || {};
    if (this.prefetching[kind]) return;
    this.prefetching[kind] = true;
    try {
      const todo = Object.entries(this.ids[kind] || {}).filter(([name]) => !fs.existsSync(this.file(kind, name)));
      for (let i = 0; i < todo.length; i += 100) {
        const chunk = todo.slice(i, i + 100);
        for (let attempt = 0; attempt < 3; attempt++) {
          const r = await fetch(`https://thumbnails.roblox.com/v1/assets?assetIds=${chunk.map(([, id]) => id).join(',')}&returnPolicy=PlaceHolder&size=420x420&format=Png&isCircular=false`);
          if (!r.ok) break;
          const byId = {};
          for (const d of (await r.json()).data || []) byId[String(d.targetId)] = d;
          let pending = 0;
          await Promise.all(chunk.map(async ([name, id]) => {
            const d = byId[id];
            if (!d || fs.existsSync(this.file(kind, name))) return;
            if (d.state === 'Pending') { pending++; return; }
            if (d.state !== 'Completed' || !d.imageUrl) return;
            try { const img = await fetch(d.imageUrl); if (img.ok) fs.writeFileSync(this.file(kind, name), Buffer.from(await img.arrayBuffer())); } catch { /* next time */ }
          }));
          if (!pending) break;
          await new Promise(res => setTimeout(res, 1500));
        }
      }
    } catch { /* offline: icons download one by one when shown */ }
    finally { this.prefetching[kind] = false; }
  }

  // data: URL of a png on disk, cached in memory until the file changes
  pngUrl(f) {
    const mtime = fs.statSync(f).mtimeMs, hit = this.urls.get(f);
    if (hit && hit.mtime === mtime) return hit.url;
    const url = this.pngUrl(f);
    if (this.urls.size >= 300) this.urls.delete(this.urls.keys().next().value);
    this.urls.set(f, { mtime, url });
    return url;
  }

  file(kind, name) { return path.join(this.dir, kind + '-' + norm(name) + '.png'); }

  // data: URL for a pet / trait picture, downloading it the first time; null when unknown
  // brainrot picture: rendered from its game model (name + mutation), else from its plain-name model
  async petPicture(name, mutation) {
    // a real 2D picture from the game (the few brainrots that have one) wins
    if (this.ids.pets && this.ids.pets[name]) { const u = await this.dataUrl('pets', name); if (u) return u; }
    const keys = [name + '|None', name + '|' + (mutation || 'None')];   // normal model first
    for (const key of keys) {
      const f = this.file('render1024', key);
      if (fs.existsSync(f)) return this.pngUrl(f);
      const mf = path.join(this.dir, 'models', norm(key) + '.json');
      if (!fs.existsSync(mf)) continue;
      const job = 'render:' + key;
      if (!this.inflight.has(job)) this.inflight.set(job, this.renderModel(JSON.parse(fs.readFileSync(mf, 'utf8')), f).finally(() => this.inflight.delete(job)));
      if (await this.inflight.get(job)) return this.pngUrl(f);
    }
    return this.dataUrl('pets', name);
  }

  async renderModel(model, outFile) {
    const meshes = {}, textures = {};
    const want = { mesh: new Set(), tex: new Set() };
    for (const p of model.parts) {
      if (p.mesh) want.mesh.add(p.mesh);
      if (p.special && p.special.mesh) want.mesh.add(p.special.mesh);
      for (const t of [p.texture, p.special && p.special.texture, ...(p.decals || []).map(d => d.texture)]) if (t) want.tex.add(t);
    }
    for (const id of want.mesh) {
      try { meshes[id] = await parseMeshAsync(await this.asset(id)); } catch (e) { this.store.log('warn', `[Art] mesh ${id}: ${e.message}`); }
    }
    for (const id of want.tex) {
      try { textures[id] = 'data:image/png;base64,' + (await this.imageAsset(id)).toString('base64'); } catch (e) { this.store.log('warn', `[Art] texture ${id}: ${e.message}`); }
    }
    const url = await this.render({ parts: model.parts, meshes, textures, bones: model.bones || {} });
    if (!url) return false;
    fs.writeFileSync(outFile, Buffer.from(String(url).split(',')[1], 'base64'));
    return true;
  }

  // raw asset bytes from assetdelivery (needs a logged-in cookie), cached on disk
  async asset(id) {
    const f = path.join(this.dir, 'assets', String(id));
    if (fs.existsSync(f)) return fs.readFileSync(f);
    const cookie = this.getCookie && this.getCookie();
    if (!cookie) throw new Error('add a stock account cookie (Roblox Accounts) so Zotac can download game assets');
    const r = await fetch(`https://assetdelivery.roblox.com/v1/asset/?id=${id}`, { headers: { Cookie: `.ROBLOSECURITY=${cookie}`, 'User-Agent': 'Roblox/WinInet', 'Roblox-Place-Id': '109983668079237' } });
    if (!r.ok) throw new Error('assetdelivery HTTP ' + r.status);
    let buf = Buffer.from(await r.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
    fs.writeFileSync(f, buf);
    return buf;
  }
  // texture ids can be Decals (an XML wrapper pointing at the Image asset)
  async imageAsset(id, depth = 0) {
    const buf = await this.asset(id);
    if (buf[0] === 0x89 && buf[1] === 0x50) return buf;                          // PNG
    if (buf[0] === 0xff && buf[1] === 0xd8) return buf;                          // JPEG
    const m = buf.toString('utf8', 0, Math.min(buf.length, 4000)).match(/asset\/?\?id=(\d+)/i);
    if (m && depth < 2) return this.imageAsset(m[1], depth + 1);
    throw new Error('not an image');
  }

  async dataUrl(kind, name) {
    const f = this.file(kind, name);
    if (fs.existsSync(f)) return this.pngUrl(f);
    const id = this.ids[kind] && (this.ids[kind][name] || Object.entries(this.ids[kind]).find(([k]) => norm(k) === norm(name))?.[1]);
    if (!id) return null;
    const key = kind + ':' + id;
    if (!this.inflight.has(key)) this.inflight.set(key, this.download(id, f).finally(() => this.inflight.delete(key)));
    const ok = await this.inflight.get(key);
    return ok ? this.pngUrl(f) : null;
  }

  async download(id, file) {
    try {
      for (let i = 0; i < 4; i++) {   // thumbnails can be "Pending" for a moment
        const r = await fetch(`https://thumbnails.roblox.com/v1/assets?assetIds=${id}&returnPolicy=PlaceHolder&size=420x420&format=Png&isCircular=false`);
        if (!r.ok) return false;
        const j = await r.json();
        const d = (j.data || [])[0];
        if (d && d.state === 'Completed' && d.imageUrl) {
          const img = await fetch(d.imageUrl);
          if (!img.ok) return false;
          fs.writeFileSync(file, Buffer.from(await img.arrayBuffer()));
          return true;
        }
        if (d && d.state !== 'Pending') return false;   // Blocked / Error
        await new Promise(res => setTimeout(res, 1500));
      }
    } catch { /* offline */ }
    return false;
  }

  status() {
    const out = {};
    for (const kind of ['pets', 'traits', 'mutations']) {
      const names = Object.keys(this.ids[kind] || {});
      out[kind] = { known: names.length, cached: names.filter(n => fs.existsSync(this.file(kind, n))).length };
    }
    return out;
  }
}

module.exports = { Art };
