// Auto Update from GitHub.
// - Installed app (packaged): latest GitHub release -> download the .exe installer and run it.
// - Running from source (npm start): when the repo's package.json version is higher, or main has
//   new commits since the last update, download main as a zip, copy it over the app folder
//   (node_modules and user data are untouched), run `npm install` if dependencies changed,
//   and restart.
const { app, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const DEFAULT_REPO = 'NUkecodesr/Eldorado-Lister';
const BRANCH = 'main';
const GH = { Accept: 'application/vnd.github+json', 'User-Agent': 'ZotacLister-updater' };

const cmp = (a, b) => {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

// accepts "owner/name", a bare "name" (default owner) or a github.com link
function normRepo(repo) {
  let r = String(repo || '').trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const m = r.match(/github\.com\/([\w.-]+\/[\w.-]+)/i);
  if (m) r = m[1];
  if (!r) return DEFAULT_REPO;
  if (/^[\w.-]+$/.test(r)) return DEFAULT_REPO.split('/')[0] + '/' + r;
  return /^[\w.-]+\/[\w.-]+$/.test(r) ? r : null;
}

async function gh(url) {
  const r = await fetch(url, { headers: GH });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('GitHub HTTP ' + r.status + (r.status === 403 ? ' (rate limited, try again later)' : ''));
  return r.json();
}

async function checkUpdate(repoSetting, installedSha) {
  const repo = normRepo(repoSetting);
  if (!repo) return { error: 'Repo must look like owner/name' };
  const current = app.getVersion();
  try {
    if (app.isPackaged) {
      const rel = await gh(`https://api.github.com/repos/${repo}/releases/latest`);
      if (rel) {
        const asset = (rel.assets || []).find(a => /\.exe$/i.test(a.name));
        return { repo, mode: 'release', current, latest: rel.tag_name, newer: cmp(rel.tag_name, current) > 0,
          asset: asset && { name: asset.name, url: asset.browser_download_url, size: asset.size }, notes: rel.body || '', page: rel.html_url };
      }
    }
    // source: compare package.json version, then the last commit
    const [commit, pkgFile] = await Promise.all([
      gh(`https://api.github.com/repos/${repo}/commits/${BRANCH}`),
      gh(`https://api.github.com/repos/${repo}/contents/package.json?ref=${BRANCH}`)
    ]);
    if (!commit) return { error: `Repo ${repo} not found (or it is private)` };
    let latest = current;
    try { latest = JSON.parse(Buffer.from(pkgFile.content, 'base64').toString('utf8')).version || current; } catch { /* keep current */ }
    const sha = commit.sha;
    const newer = cmp(latest, current) > 0 || (!!installedSha && installedSha !== sha && cmp(latest, current) >= 0);
    return { repo, mode: app.isPackaged ? 'page' : 'source', current, latest: newer && cmp(latest, current) === 0 ? `${latest} (${sha.slice(0, 7)})` : latest,
      newer, sha, notes: (commit.commit && commit.commit.message) || '', page: `https://github.com/${repo}` };
  } catch (e) {
    return { error: e.message };
  }
}

const run = (cmd, args, opts) => new Promise((res, rej) => execFile(cmd, args, { windowsHide: true, maxBuffer: 1 << 26, ...opts }, (e, out, err) => e ? rej(new Error((err || e.message).toString().slice(0, 400))) : res(out)));

function copyTree(src, dst) {
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const s = path.join(src, ent.name), d = path.join(dst, ent.name);
    if (ent.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyTree(s, d); } else fs.copyFileSync(s, d);
  }
}

async function installUpdate(info, { onDone, log } = {}) {
  if (!info) throw new Error('Check for updates first');
  if (info.mode === 'release') {
    if (!info.asset) { shell.openExternal(info.page); return { opened: true }; }
    const dest = path.join(os.tmpdir(), `zotac-update-${Date.now()}`, info.asset.name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const r = await fetch(info.asset.url);
    if (!r.ok) throw new Error('Download HTTP ' + r.status);
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    spawn(dest, [], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 800);
    return { installing: true };
  }
  if (info.mode !== 'source') { shell.openExternal(info.page); return { opened: true }; }

  const appDir = app.getAppPath();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zotac-update-'));
  const zip = path.join(tmp, 'src.zip');
  const r = await fetch(`https://api.github.com/repos/${info.repo}/zipball/${info.sha || BRANCH}`, { headers: GH });
  if (!r.ok) throw new Error('Download HTTP ' + r.status);
  fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
  const out = path.join(tmp, 'x');
  fs.mkdirSync(out);
  await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', out]);
  const top = fs.readdirSync(out).map(n => path.join(out, n)).find(p => fs.existsSync(path.join(p, 'package.json')));
  if (!top) throw new Error('Downloaded zip has no package.json');

  const deps = f => { try { const p = JSON.parse(fs.readFileSync(f, 'utf8')); return JSON.stringify([p.dependencies, p.devDependencies]); } catch { return ''; } };
  const depsChanged = deps(path.join(top, 'package.json')) !== deps(path.join(appDir, 'package.json'));
  copyTree(top, appDir);
  if (log) log(`[Update] source updated to ${info.latest} in ${appDir}`);
  if (depsChanged) {
    if (log) log('[Update] dependencies changed, running npm install');
    await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], { cwd: appDir, shell: true });
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ }
  if (onDone) onDone(info.sha);
  setTimeout(() => { app.relaunch(); app.exit(0); }, 600);
  return { restarting: true };
}

module.exports = { checkUpdate, installUpdate, normRepo, DEFAULT_REPO };
