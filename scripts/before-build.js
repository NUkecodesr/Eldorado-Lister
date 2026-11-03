// electron-builder beforeBuild hook. Its winCodeSign archive holds macOS symlinks that 7-Zip cannot
// create on Windows without Developer Mode or admin ("Cannot create symbolic link"), so the build
// died while extracting it. Pre-extract the archive here without the darwin folder (only the
// Windows tools are used); electron-builder then finds the cache folder and skips its own extract.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const NAME = 'winCodeSign-2.6.0';
const URL = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${NAME}/${NAME}.7z`;

const cacheRoot = () => process.env.ELECTRON_BUILDER_CACHE
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron-builder', 'Cache');

module.exports = async function beforeBuild() {
  if (process.platform !== 'win32') return true;
  const dest = path.join(cacheRoot(), 'winCodeSign', NAME);
  if (fs.existsSync(path.join(dest, 'rcedit-x64.exe'))) return true;
  const tmp = `${dest}.tmp-${process.pid}`;
  const archive = `${tmp}.7z`;
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const res = await fetch(URL, { redirect: 'follow' });
    if (!res.ok) throw new Error(`download ${res.status}`);
    fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
    execFileSync(require('7zip-bin').path7za, ['x', '-bd', '-y', '-snld', '-xr!darwin', archive, `-o${tmp}`], { stdio: 'pipe' });
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
    console.log(`  • winCodeSign cached without macOS files  path=${dest}`);
  } catch (e) {
    console.warn(`  • winCodeSign pre-extract failed, electron-builder will try itself: ${e.message}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(archive, { force: true });
  }
  return true;
};
