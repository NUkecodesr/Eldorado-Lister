// Legit mode: a clean, official Roblox client in Zotac's own folder, so an account can be opened
// without the executor (the executor patches the normal Roblox install). Installed the way the
// official bootstrapper / Bloxstrap do it: current client version -> package manifest -> each zip
// from Roblox's CDN (MD5 checked) -> unpacked where the official installer puts it. Kept up to date:
// Roblox refuses old clients, so every legit launch checks the version first.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const EventEmitter = require('events');

const VERSION_URL = 'https://clientsettingscdn.roblox.com/v2/client-version/WindowsPlayer';
const CDN = 'https://setup.rbxcdn.com/';
// where each package goes inside the client folder (same map as the official installer)
const PKG_DIRS = {
  'RobloxApp.zip': '', 'redist.zip': '', 'WebView2.zip': '',
  'shaders.zip': 'shaders', 'ssl.zip': 'ssl', 'WebView2RuntimeInstaller.zip': 'WebView2RuntimeInstaller',
  'content-avatar.zip': 'content/avatar', 'content-configs.zip': 'content/configs', 'content-fonts.zip': 'content/fonts',
  'content-sky.zip': 'content/sky', 'content-sounds.zip': 'content/sounds', 'content-textures2.zip': 'content/textures',
  'content-models.zip': 'content/models',
  'content-platform-fonts.zip': 'PlatformContent/pc/fonts', 'content-platform-dictionaries.zip': 'PlatformContent/pc/shared_compression_dictionaries',
  'content-terrain.zip': 'PlatformContent/pc/terrain', 'content-textures3.zip': 'PlatformContent/pc/textures',
  'extracontent-luapackages.zip': 'ExtraContent/LuaPackages', 'extracontent-translations.zip': 'ExtraContent/translations',
  'extracontent-models.zip': 'ExtraContent/models', 'extracontent-textures.zip': 'ExtraContent/textures',
  'extracontent-places.zip': 'ExtraContent/places'
};
const APP_SETTINGS = '<?xml version="1.0" encoding="UTF-8"?>\r\n<Settings>\r\n\t<ContentFolder>content</ContentFolder>\r\n\t<BaseUrl>http://www.roblox.com</BaseUrl>\r\n</Settings>\r\n';

function untar(zip, dest) {
  // Windows 10+ ships bsdtar, which unpacks zip files
  return new Promise((res, rej) => execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', dest],
    { windowsHide: true, timeout: 300000 }, err => (err ? rej(new Error('unpacking ' + path.basename(zip) + ': ' + err.message)) : res())));
}

class LegitRoblox extends EventEmitter {
  constructor({ dir, log }) {
    super();
    this.dir = dir; this.log = log || (() => {});
    this.busy = null;
  }
  stateFile() { return path.join(this.dir, 'installed.json'); }
  installed() {
    try {
      const s = JSON.parse(fs.readFileSync(this.stateFile(), 'utf8'));
      const exe = path.join(this.dir, s.version, 'RobloxPlayerBeta.exe');
      return fs.existsSync(exe) ? { version: s.version, exe, at: s.at } : null;
    } catch { return null; }
  }
  // Roblox's current client version, asked at most every 10 min (every Legit launch checks it)
  async latest() {
    if (this.latestHit && Date.now() - this.latestHit.at < 10 * 60000) return this.latestHit.v;
    const v = await this.latestNow();
    this.latestHit = { v, at: Date.now() };
    return v;
  }
  async latestNow() {
    const r = await fetch(VERSION_URL);
    if (!r.ok) throw new Error('Roblox version check HTTP ' + r.status);
    const j = await r.json();
    if (!/^version-[0-9a-f]+$/.test(j.clientVersionUpload || '')) throw new Error('unexpected Roblox version reply');
    return { version: j.clientVersionUpload, label: j.version };
  }
  async status() {
    const inst = this.installed();
    let latest = null;
    try { latest = await this.latest(); } catch (e) { latest = { error: e.message }; }
    return { dir: this.dir, installed: inst, latest, upToDate: !!(inst && latest && inst.version === latest.version) };
  }

  // the client to launch: installs or updates first when needed (one install at a time)
  ensure() {
    if (this.busy) return this.busy;
    this.busy = (async () => {
      const inst = this.installed();
      let want;
      try { want = await this.latest(); } catch (e) { if (inst) return inst.exe; throw e; }   // offline: use what we have
      if (inst && inst.version === want.version) return inst.exe;
      return this.install(want.version, want.label);
    })().finally(() => { this.busy = null; });
    return this.busy;
  }
  reinstall() {
    if (this.busy) return this.busy;
    this.busy = (async () => { const w = await this.latest(); return this.install(w.version, w.label, true); })().finally(() => { this.busy = null; });
    return this.busy;
  }

  async install(version, label, force) {
    fs.mkdirSync(this.dir, { recursive: true });
    const target = path.join(this.dir, version);
    if (!force && fs.existsSync(path.join(target, 'RobloxPlayerBeta.exe')) && fs.existsSync(path.join(target, '.complete'))) {
      fs.writeFileSync(this.stateFile(), JSON.stringify({ version, label, at: Date.now() }));
      return path.join(target, 'RobloxPlayerBeta.exe');
    }
    const tmp = target + '.partial';
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(path.join(tmp, '_dl'), { recursive: true });
    const mr = await fetch(CDN + version + '-rbxPkgManifest.txt');
    if (!mr.ok) throw new Error('Roblox package list HTTP ' + mr.status);
    const lines = (await mr.text()).trim().split(/\r?\n/);
    if (lines[0] !== 'v0') throw new Error('unknown Roblox package list format ' + lines[0]);
    const pkgs = [];
    for (let i = 1; i + 3 < lines.length + 1; i += 4) pkgs.push({ name: lines[i], md5: lines[i + 1], size: Number(lines[i + 2]) || 0 });
    const wanted = pkgs.filter(p => p.name.endsWith('.zip'));
    const unknown = wanted.filter(p => !(p.name in PKG_DIRS));
    if (unknown.length) this.log('warn', '[Legit] new Roblox packages, unpacked in the client folder: ' + unknown.map(p => p.name).join(', '));
    const total = wanted.reduce((s, p) => s + p.size, 0) || 1;
    let done = 0;
    this.emit('progress', { phase: 'download', pct: 0, version, label });
    this.log('info', `[Legit] installing real Roblox ${label || version} (${wanted.length} packages, ${Math.round(total / 1e6)} MB) into ${target}`);
    for (const p of wanted) {
      const r = await fetch(CDN + version + '-' + p.name);
      if (!r.ok) throw new Error(`${p.name}: HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const md5 = crypto.createHash('md5').update(buf).digest('hex');
      if (md5 !== p.md5) throw new Error(`${p.name}: checksum mismatch (download damaged), try again`);
      const zip = path.join(tmp, '_dl', p.name);
      fs.writeFileSync(zip, buf);
      const dest = path.join(tmp, PKG_DIRS[p.name] !== undefined ? PKG_DIRS[p.name] : '');
      fs.mkdirSync(dest, { recursive: true });
      await untar(zip, dest);
      fs.unlinkSync(zip);
      done += p.size;
      this.emit('progress', { phase: 'download', pct: Math.round(100 * done / total), mb: Math.round(done / 1e6), totalMb: Math.round(total / 1e6), version, label });
    }
    fs.rmSync(path.join(tmp, '_dl'), { recursive: true, force: true });
    fs.writeFileSync(path.join(tmp, 'AppSettings.xml'), APP_SETTINGS);
    if (!fs.existsSync(path.join(tmp, 'RobloxPlayerBeta.exe'))) throw new Error('install finished without RobloxPlayerBeta.exe');
    fs.writeFileSync(path.join(tmp, '.complete'), String(Date.now()));
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(tmp, target);
    fs.writeFileSync(this.stateFile(), JSON.stringify({ version, label, at: Date.now() }));
    // older client versions are no longer needed (skipped when one is still running)
    for (const d of fs.readdirSync(this.dir)) {
      if (d !== version && /^version-[0-9a-f]+$/.test(d)) { try { fs.rmSync(path.join(this.dir, d), { recursive: true, force: true }); } catch { /* in use */ } }
    }
    this.emit('progress', { phase: 'done', pct: 100, version, label });
    this.log('info', `[Legit] real Roblox ${label || version} ready`);
    return path.join(target, 'RobloxPlayerBeta.exe');
  }
}

module.exports = { LegitRoblox, PKG_DIRS };
