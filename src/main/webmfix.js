// MediaRecorder writes WebM without a duration (and without a seek index), so players show 0:00
// and can't scrub. fixDuration() writes the Duration element into the Segment's Info; remux()
// then lets ffmpeg (when installed) rewrite the file with a seek index (cues). Both are best
// effort: the original file is kept if anything fails.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// EBML variable-length integer at buf[pos]: { len, value, unknown }
function vint(buf, pos) {
  const first = buf[pos];
  let len = 1, mask = 0x80;
  while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
  if (len > 8) return null;
  let value = first & (mask - 1), allOnes = value === mask - 1;
  for (let i = 1; i < len; i++) { value = value * 256 + buf[pos + i]; if (buf[pos + i] !== 0xff) allOnes = false; }
  return { len, value, unknown: allOnes };
}
function idLen(b) { return b >= 0x80 ? 1 : b >= 0x40 ? 2 : b >= 0x20 ? 3 : 4; }
function sizeVint8(n) { const out = Buffer.alloc(8); out[0] = 0x01; let v = n; for (let i = 7; i >= 1; i--) { out[i] = v % 256; v = Math.floor(v / 256); } return out; }

function fixDuration(file, durationMs) {
  const buf = fs.readFileSync(file);
  const SEG = Buffer.from([0x18, 0x53, 0x80, 0x67]), INFO = Buffer.from([0x15, 0x49, 0xa9, 0x66]);
  const seg = buf.indexOf(SEG);
  if (seg < 0) return false;
  const segSize = vint(buf, seg + 4);
  const segData = seg + 4 + segSize.len;
  const info = buf.indexOf(INFO, segData);
  if (info < 0 || info > segData + 4096) return false;
  const infoSize = vint(buf, info + 4);
  const infoData = info + 4 + infoSize.len, infoEnd = infoData + infoSize.value;
  // walk the Info children: TimecodeScale (2AD7B1), Duration (4489)
  let scale = 1e6, p = infoData;
  const kids = [];
  while (p < infoEnd) {
    const il = idLen(buf[p]);
    const id = buf.readUIntBE(p, il);
    const sz = vint(buf, p + il);
    const end = p + il + sz.len + sz.value;
    if (id === 0x2ad7b1) scale = buf.readUIntBE(p + il + sz.len, sz.value);
    kids.push({ id, start: p, end });
    p = end;
  }
  const dur = Buffer.alloc(11);
  dur[0] = 0x44; dur[1] = 0x89; dur[2] = 0x88;            // Duration, 8-byte float
  dur.writeDoubleBE(durationMs * 1e6 / scale, 3);
  const body = Buffer.concat([...kids.filter(k => k.id !== 0x4489).map(k => buf.subarray(k.start, k.end)), dur]);
  const newInfo = Buffer.concat([INFO, sizeVint8(body.length), body]);
  const delta = newInfo.length - (infoEnd - info);
  let head = buf.subarray(0, info);
  if (!segSize.unknown) {   // a known segment size grows with the Info
    head = Buffer.from(head);
    const s = sizeVint8(segSize.value + delta);
    if (segSize.len !== 8) return false;
    s.copy(head, seg + 4);
  }
  const out = Buffer.concat([head, newInfo, buf.subarray(infoEnd)]);
  fs.writeFileSync(file + '.tmp', out);
  fs.renameSync(file + '.tmp', file);
  return true;
}

// ffmpeg on PATH, or one installed by winget
function findFfmpeg() {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) { const f = path.join(d, 'ffmpeg.exe'); if (fs.existsSync(f)) return f; }
  const pk = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const p of fs.readdirSync(pk).filter(n => /ffmpeg/i.test(n))) {
      const base = path.join(pk, p);
      for (const sub of fs.readdirSync(base)) { const f = path.join(base, sub, 'bin', 'ffmpeg.exe'); if (fs.existsSync(f)) return f; }
    }
  } catch { /* no winget */ }
  return null;
}

function remux(file) {
  const ff = findFfmpeg();
  if (!ff) return Promise.resolve(false);
  const tmp = file.replace(/\.webm$/, '.remux.webm');
  return new Promise(res => execFile(ff, ['-v', 'error', '-y', '-i', file, '-c', 'copy', tmp], { windowsHide: true, timeout: 120000 }, err => {
    try {
      if (!err && fs.existsSync(tmp) && fs.statSync(tmp).size > 1000) { fs.renameSync(tmp, file); return res(true); }
    } catch { /* keep the original */ }
    try { fs.unlinkSync(tmp); } catch { /* none */ }
    res(false);
  }));
}

module.exports = { fixDuration, remux, findFfmpeg };
