// Walk routes inside a base for the Security-mode steal, learned from a route the user walked by
// hand with scanner/zotac_path_recorder.lua (PathfindingService could not reach the upper floors:
// the stairs are outside the base and floor 3 is a ladder). Every base is the same model, so the
// route is kept relative to the base's pivot and works in any base, whichever way it faces.
//
// Graph: nodes [x, y, z, kind] (kind 0 walk, 1 climb, 2 in the air), edges [from, to] one way.
// Recorded order = one-way edges (climbs, drops); walking edges on a floor or the stairs also go
// back; nearby walk nodes on the same level are joined. `slots` = where the user stood to steal
// at each podium; `exits` = ground nodes at the front / outside, where the walk home starts.
const fs = require('fs');
const path = require('path');

const AIR = new Set(['Freefall', 'Jumping', 'FallingDown']);
const kindOf = st => (st === 'Climbing' ? 1 : AIR.has(st) ? 2 : 0);
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

function build(rec) {
  if (!rec || !Array.isArray(rec.points) || !rec.plots) throw new Error('not a path recording');
  // the base the route was walked in: the one with the most podium marks
  const count = {};
  for (const m of rec.marks || []) if (m.kind === 'podium' && m.plot) count[m.plot] = (count[m.plot] || 0) + 1;
  const plot = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
  if (!plot) throw new Error('the recording has no podium marks');
  const markAt = {};
  for (const m of rec.marks || []) if (m.plot === plot && m.kind === 'podium' && m.slot) markAt[m.i - 1] = m.slot;

  // simplify: a node every ~2.5 studs, at every state change, every climb/air point and every mark
  const nodes = [], order = [], slots = {};
  let last = null, lastKind = null, lastIdx = -1;
  rec.points.forEach((p, i) => {
    if (p.plot !== plot || !p.rel) return;
    const k = p.st === 'Mark' ? (lastKind ?? 0) : kindOf(p.st);
    const slot = markAt[i] || (p.st === 'Mark' ? markAt[i - 1] : null) || null;
    const far = !last || Math.hypot(p.rel[0] - last[0], p.rel[1] - last[1], p.rel[2] - last[2]) >= 2.5;
    const gap = lastIdx >= 0 && i !== lastIdx + 1;   // left this base and came back
    if (far || k !== 0 || k !== lastKind || slot || gap) {
      nodes.push([p.rel[0], p.rel[1], p.rel[2], k, p.inside ? 1 : 0]);
      order.push(gap ? -1 : nodes.length - 1);
      if (slot && !(slot in slots)) slots[slot] = nodes.length - 1;
      last = p.rel; lastKind = k;
    }
    lastIdx = i;
  });
  const edges = [], seen = new Set();
  const add = (a, b) => { const key = a + '>' + b; if (a !== b && !seen.has(key)) { seen.add(key); edges.push([a, b]); } };
  for (let i = 1; i < order.length; i++) {
    const a = order[i - 1], b = order[i];
    if (a < 0 || b < 0) continue;
    add(a, b);
    const A = nodes[a], B = nodes[b];
    // walking (floor or stairs) also works backwards; climbs and drops only as recorded
    if (A[3] === 0 && B[3] === 0 && Math.abs(A[1] - B[1]) <= 2.5) add(b, a);
  }
  for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
    const A = nodes[a], B = nodes[b];
    if (A[3] || B[3] || A[4] !== B[4] || Math.abs(A[1] - B[1]) > 1.2 || flat(A, B) > 4) continue;
    add(a, b); add(b, a);
  }
  // a podium without a mark: the nearest walked spot on its floor (within 8 studs of its prompt)
  for (const q of rec.plots[plot].podiums || []) {
    if (q.slot in slots || !(q.prompt || q.rel)) continue;
    const at = q.prompt || q.rel;
    let best = -1, bestD = 8;
    nodes.forEach((n, i) => { const d = flat(n, at); if (n[3] === 0 && Math.abs(n[1] - at[1]) < 4 && d < bestD) { best = i; bestD = d; } });
    if (best >= 0) slots[q.slot] = best;
  }
  // ground level at the front of the base or outside it: the walk home starts there
  const floorY = Math.min(...nodes.filter(n => n[3] === 0).map(n => n[1]));
  const exits = [];
  nodes.forEach((n, i) => { if (n[3] === 0 && n[1] <= floorY + 1.5 && (n[4] === 0 || n[2] < -25)) exits.push(i); });
  return {
    v: 1, from: { by: rec.by, at: rec.at, plot },
    nodes: nodes.map(n => [n[0], n[1], n[2], n[3]]), edges, slots, exits,
    podiums: (rec.plots[plot].podiums || []).map(q => ({ slot: q.slot, prompt: q.prompt || q.rel })),
  };
}

// the route to use: a user-made one in userData wins over the bundled one
function load(userDataDir) {
  for (const f of [userDataDir && path.join(userDataDir, 'base-route.json'), path.join(__dirname, '..', '..', 'assets', 'base-route.json')]) {
    try { if (f && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* next */ }
  }
  return null;
}

module.exports = { build, load };

// node src/main/baseroute.js <recording.json> [out.json]
if (require.main === module) {
  const rec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const r = build(rec);
  const out = process.argv[3] || path.join(__dirname, '..', '..', 'assets', 'base-route.json');
  fs.writeFileSync(out, JSON.stringify(r));
  console.log(`${out}: ${r.nodes.length} nodes, ${r.edges.length} edges, slots ${Object.keys(r.slots).sort((a, b) => a - b).join(',')}, ${r.exits.length} exits`);
}
