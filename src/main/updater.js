// Auto Update: checks the latest GitHub release of the configured repo
// ("owner/name"), downloads the Windows installer asset and runs it.
const { app, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const cmp = (a, b) => {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

async function checkUpdate(repo) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) return { error: 'Set the update repo as owner/name in Settings' };
  const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) return { error: 'GitHub HTTP ' + r.status };
  const rel = await r.json();
  const latest = rel.tag_name;
  const asset = (rel.assets || []).find(a => /\.exe$/i.test(a.name));
  return { current: app.getVersion(), latest, newer: cmp(latest, app.getVersion()) > 0, asset: asset && { name: asset.name, url: asset.browser_download_url, size: asset.size }, notes: rel.body || '', page: rel.html_url };
}

async function installUpdate(info) {
  if (!info || !info.asset) { if (info && info.page) shell.openExternal(info.page); return { opened: true }; }
  const dest = path.join(os.tmpdir(), `zotac-update-${Date.now()}`, info.asset.name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const r = await fetch(info.asset.url);
  if (!r.ok) throw new Error('Download HTTP ' + r.status);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  spawn(dest, [], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => app.quit(), 800);
  return { installing: true };
}

module.exports = { checkUpdate, installUpdate };
