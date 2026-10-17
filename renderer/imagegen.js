// Automatic listing image: 600x600 card drawn on a canvas, returned as a PNG data URL.
// The card is built from layers (background, pet picture, traits row, pet name, M/s label,
// shop name) placed by an image template (Templates -> Image Editor). Positions are % of the
// 600px canvas, centre-anchored. The built-in "Default" template is the classic Zotac card.
const MUTATION_COLORS = {
  none: ['#3a3022', '#15110c'], gold: ['#f6c343', '#6b4a06'], diamond: ['#8fe3ff', '#164a63'], rainbow: null,
  lava: ['#ff7a2f', '#5a1405'], galaxy: ['#9b6bff', '#1a0d4a'], candy: ['#ff8fd0', '#6a1a4a'], bloodrot: ['#d3243a', '#3a0509'],
  cyber: ['#33e6ff', '#062f3d'], cursed: ['#e0262a', '#3a0505'], divine: ['#ffe9a6', '#7a5a12'], radioactive: ['#9dff3a', '#1f3d05'],
  'yin-yang': ['#f2f2f2', '#111111'], phantom: ['#7f8ea8', '#161c27'], crystal: ['#b6f4ff', '#25546a'], eclipse: ['#5b4dbb', '#07061a']
};
const RARITY_COLORS = { Secret: '#f2f2f2', OG: '#ff4d6d', 'Brainrot God': '#ffcf3a', Mythic: '#ff5ad1', Legendary: '#ffb02e', Epic: '#a66bff', Rare: '#4fa3f7', Common: '#9aa0a6', Admin: '#ff3b3b' };

// ---- image templates --------------------------------------------------------
const IMG_LAYERS = ['shop', 'gen', 'name', 'traits', 'pet', 'bg'];
const IMG_LAYER_LABEL = { shop: 'Shop name', gen: 'M/s label', name: 'Pet name', traits: 'Traits', pet: 'Pet image', bg: 'Background' };
// Default = the classic card, pixel for pixel: name centre y 140, gen 189, icon row centre 63,
// pet box 468 x 359 from y 223 (shrinks to end at 554 when a shop name is drawn), shop y 576.
const DEFAULT_IMAGE_TEMPLATE = {
  id: 'default', name: 'Default',
  order: ['shop', 'gen', 'name', 'traits', 'pet', 'bg'],   // first = drawn in FRONT
  layers: {
    shop: { visible: true, x: 50, y: 96, size: 20, color: '#ffffff', alpha: 0.85, stroke: true, upper: false },
    gen: { visible: true, x: 50, y: 31.5, size: 42, color: '#f2b631', gradient: true, stroke: true, upper: false },
    name: { visible: true, x: 50, y: 140 / 6, size: 46, color: '#ffffff', stroke: true, upper: true },
    traits: { visible: true, x: 50, y: 10.5, size: 58, gap: 10, mutation: true },
    pet: { visible: true, x: 50, y: 402.5 / 6, w: 78, h: 359 / 6 },
    bg: { visible: true, mode: 'dark', color: '#15110c', image: '' }
  }
};

// Fill in missing layers/keys from Default and coerce every value to Default's type, so
// old, hand-edited or imported templates can't break the renderer.
function normImageTemplate(t) {
  const d = DEFAULT_IMAGE_TEMPLATE;
  t = t && typeof t === 'object' ? t : d;
  const layers = {};
  for (const k of IMG_LAYERS) {
    const src = (t.layers && typeof t.layers === 'object' && t.layers[k]) || {};
    layers[k] = {};
    for (const [key, def] of Object.entries(d.layers[k])) {
      const v = src[key];
      if (typeof def === 'number') { const n = Number(v); layers[k][key] = v !== undefined && v !== null && v !== '' && isFinite(n) ? n : def; }
      else if (typeof def === 'boolean') layers[k][key] = typeof v === 'boolean' ? v : def;
      else layers[k][key] = typeof v === 'string' ? v : def;
    }
  }
  if (!['dark', 'glow', 'solid', 'image'].includes(layers.bg.mode)) layers.bg.mode = 'dark';
  const order = [...new Set([...(Array.isArray(t.order) ? t.order : []), ...d.order])].filter(k => IMG_LAYERS.includes(k) && k !== 'bg');
  order.push('bg');   // background always sits at the back
  return { id: String(t.id || 'default'), name: String(t.name || 'Default'), layers, order };
}
function imageTemplateById(id) {
  const st = (typeof S !== 'undefined' && S && S.settings) || {};
  const t = id && id !== 'default' ? (st.imageTemplates || []).find(x => x && x.id === id) : null;
  return normImageTemplate(t || DEFAULT_IMAGE_TEMPLATE);
}
function activeImageTemplate() {
  const st = (typeof S !== 'undefined' && S && S.settings) || {};
  return imageTemplateById(st.activeImageTemplate);
}

const IMG_CACHE = new Map();
function loadImg(src) {
  if (!src) return Promise.resolve(null);
  if (IMG_CACHE.has(src)) return IMG_CACHE.get(src);
  const p = new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  IMG_CACHE.set(src, p);
  if (IMG_CACHE.size > 60) IMG_CACHE.delete(IMG_CACHE.keys().next().value);
  return p;
}

async function renderListingImage(opts) {
  return (await renderCardCanvas(opts)).canvas.toDataURL('image/png');
}

// Draws the card and returns { canvas, boxes } — boxes are each drawn layer's bounds in px
// (used by the Image Editor for its dashed guides / hit areas).
async function renderCardCanvas({ pet, rarity, art, traitArt = [], mutationArt = null, shopName = '', recolor = true, template = null }) {
  const T = normImageTemplate(template || activeImageTemplate());
  const L = T.layers, W = 600;
  const px = v => Math.round(Number(v) * W) / 100;   // % of the canvas -> px (0.01 px grid)
  const c = document.createElement('canvas'); c.width = W; c.height = W;
  const g = c.getContext('2d');
  const mkey = String(pet.mutation || 'none').toLowerCase().replace(/\s+/g, '-');
  const mutated = mkey !== 'none' && mkey !== 'normal';
  const known = mkey in MUTATION_COLORS;
  const pal = known ? MUTATION_COLORS[mkey] : MUTATION_COLORS.none;   // rainbow = null (gradient)
  // same look for every card: mutation colour glow when mutated, otherwise Zotac gold
  const tint = !pal ? '#a66bff' : (mutated ? pal[0] : '#f2b631');
  shopName = String(shopName || '');

  // icon row: the mutation block first (its game icon, else a block in the mutation's
  // colours, like the game draws it), then each trait's game icon
  const traits = traitArt.length ? traitArt : (pet.traits || []).slice(0, 6).map(name => ({ name, url: null }));
  const icons = [...(mutated && L.traits.mutation ? [{ name: pet.mutation, url: mutationArt && mutationArt.url, mutation: true }] : []), ...traits];
  const mutIcon = mutationArt && mutationArt.url ? await loadImg(mutationArt.url) : null;
  const [petImg, bgImg, ...iconImgs] = await Promise.all([
    L.pet.visible ? loadImg(art) : null,
    L.bg.visible && L.bg.mode === 'image' ? loadImg(L.bg.image) : null,
    ...icons.map(t => (L.traits.visible ? loadImg(t.url) : null))]);

  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  const boxes = {};

  // pet name: shrinks to fit; the M/s label and pet box stacked right under it follow it up
  const nameText = L.name.upper ? String(pet.name || '').toUpperCase() : String(pet.name || '');
  const nameX = px(L.name.x), nameY = px(L.name.y), nameBase = Math.max(6, L.name.size);
  const nameMax = Math.max(60, 2 * Math.min(nameX, W - nameX) - 40);
  const nameMin = Math.round(nameBase * 24 / 46);
  let nameSize = nameBase; g.font = `900 ${nameSize}px Segoe UI`;
  while (g.measureText(nameText).width > nameMax && nameSize > nameMin) { nameSize -= 2; g.font = `900 ${nameSize}px Segoe UI`; }
  const dy = L.name.visible ? (nameSize - nameBase) / 2 : 0;

  const genX = px(L.gen.x), genY0 = px(L.gen.y);
  const genStacked = dy && L.gen.visible && genY0 > nameY && genY0 - nameY <= 90 && Math.abs(genX - nameX) < 80;
  const genY = genY0 + (genStacked ? dy : 0);

  const petX = px(L.pet.x), petCY = px(L.pet.y), bw = px(L.pet.w), bh0 = px(L.pet.h);
  let top = petCY - bh0 / 2, bottom = petCY + bh0 / 2;
  if (genStacked && top > genY0 && top - genY0 <= 80) top += dy;
  const shopOn = L.shop.visible && !!shopName;
  const shopX = px(L.shop.x), shopY = px(L.shop.y);
  if (shopOn && shopY > petCY && Math.abs(shopX - petX) < bw / 2 + 120) bottom = Math.min(bottom, shopY - 22 * L.shop.size / 20);
  if (bottom < top + 10) bottom = top + 10;
  const glowY = petCY + 17.5;

  const text = (str, x, y, size, weight, Lr, strokeK) => {
    g.font = `${weight} ${size}px Segoe UI`;
    if (Lr.stroke) { g.lineWidth = Lr.size * strokeK; g.strokeStyle = '#000'; g.strokeText(str, x, y); }
  };

  const draw = {
    bg() {
      const B = L.bg;
      if (B.mode === 'image' && bgImg) {
        const r = Math.max(W / bgImg.width, W / bgImg.height), w = bgImg.width * r, hh = bgImg.height * r;
        g.drawImage(bgImg, (W - w) / 2, (W - hh) / 2, w, hh);
      } else { g.fillStyle = B.mode === 'solid' ? B.color : '#0b0a0d'; g.fillRect(0, 0, W, W); }
      if (B.mode === 'dark') {
        // background: near black with a soft glow behind the pet (mutation / gold tint)
        const glow = g.createRadialGradient(W / 2, glowY, 20, W / 2, glowY, 300);
        glow.addColorStop(0, tint + '55'); glow.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = glow; g.fillRect(0, 0, W, W);
      } else if (B.mode === 'glow') {
        const a = !pal ? ['#a66bff', '#ff4d6d'] : mutated ? pal : ['#f2b631', '#6b4a06'];
        const glow = g.createRadialGradient(W / 2, glowY, 10, W / 2, glowY, 430);
        glow.addColorStop(0, a[0] + 'b0'); glow.addColorStop(0.5, a[1] + '90'); glow.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = glow; g.fillRect(0, 0, W, W);
      }
      if (!pal && (B.mode === 'dark' || B.mode === 'glow')) {   // rainbow: thin multicolor band at the bottom
        const lg = g.createLinearGradient(0, 0, W, 0);
        ['#ff4d4d', '#ffb02e', '#ffe44d', '#3fcf72', '#4fa3f7', '#a66bff'].forEach((col, i, a) => lg.addColorStop(i / (a.length - 1), col));
        g.fillStyle = lg; g.fillRect(0, W - 8, W, 8);
      }
      const vg = g.createRadialGradient(W / 2, W / 2, W * 0.35, W / 2, W / 2, W * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
      g.fillStyle = vg; g.fillRect(0, 0, W, W);
    },
    traits() {
      const box = Math.max(8, L.traits.size), gap = Math.max(0, L.traits.gap), k = box / 58;
      const cx = px(L.traits.x), cy = px(L.traits.y);
      if (!icons.length) {
        // nothing to show: a rarity badge keeps the row (and so the whole layout) identical
        const label = String(rarity || pet.rarity || 'Brainrot').toUpperCase();
        g.font = `900 ${20 * k}px Segoe UI`; const w = g.measureText(label).width + 40 * k;
        pill(g, cx - w / 2, cy - 17 * k, w, 36 * k, 'rgba(255,255,255,.07)', RARITY_COLORS[rarity || pet.rarity] || 'rgba(242,182,49,.7)');
        g.fillStyle = RARITY_COLORS[rarity || pet.rarity] || '#f2b631'; g.fillText(label, cx, cy + 2 * k);
        boxes.traits = { x: cx - w / 2, y: cy - 17 * k, w, h: 36 * k };
        return;
      }
      const total = icons.length * box + (icons.length - 1) * gap, rowTop = cy - box / 2;
      let x = cx - total / 2;
      icons.forEach((t, i) => {
        const img = iconImgs[i];
        if (t.mutation && !img) {
          const ins = 7 * k, bx = x + ins, by = rowTop + ins, bs = box - 2 * ins;
          g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 10;
          const fill = g.createLinearGradient(bx, by, bx + bs, by + bs);
          if (!pal) ['#ff4d4d', '#ffe44d', '#3fcf72', '#4fa3f7', '#a66bff'].forEach((col, n, a) => fill.addColorStop(n / (a.length - 1), col));
          else { fill.addColorStop(0, pal[0]); fill.addColorStop(1, pal[1]); }
          g.beginPath(); g.roundRect(bx, by, bs, bs, 8 * k); g.fillStyle = fill; g.fill(); g.restore();
          g.beginPath(); g.roundRect(bx + 4 * k, by + 4 * k, bs - 8 * k, (bs - 8 * k) * 0.38, 5 * k); g.fillStyle = 'rgba(255,255,255,.28)'; g.fill();
          g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.roundRect(bx, by, bs, bs, 8 * k); g.stroke();
        } else if (img) {
          const r = Math.min(box / img.width, box / img.height);
          g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 10;
          g.drawImage(img, x + (box - img.width * r) / 2, rowTop + (box - img.height * r) / 2, img.width * r, img.height * r); g.restore();
        } else {
          pill(g, x, cy - 17 * k, box, 34 * k, 'rgba(255,255,255,.08)', 'rgba(255,255,255,.25)');
          let fs = Math.round(12 * k); const fmin = Math.round(8 * k); g.font = `700 ${fs}px Segoe UI`;
          while (g.measureText(String(t.name)).width > box - 6 && fs > fmin) { fs--; g.font = `700 ${fs}px Segoe UI`; }
          g.fillStyle = '#fff'; g.fillText(String(t.name), x + box / 2, cy, box - 6);
        }
        x += box + gap;
      });
      boxes.traits = { x: cx - total / 2, y: rowTop, w: total, h: box };
    },
    name() {
      text(nameText, nameX, nameY, nameSize, 900, L.name, 9 / 46);
      g.fillStyle = L.name.color; g.fillText(nameText, nameX, nameY);
      const w = g.measureText(nameText).width;
      boxes.name = { x: nameX - w / 2, y: nameY - nameSize / 2, w, h: nameSize };
    },
    gen() {
      const s = Math.max(6, L.gen.size), str = L.gen.upper ? formatGen(pet.gen).toUpperCase() : formatGen(pet.gen);
      text(str, genX, genY, s, 900, L.gen, 8 / 42);
      if (L.gen.gradient) {
        const gg = g.createLinearGradient(0, genY - s * 22 / 42, 0, genY + s * 22 / 42); gg.addColorStop(0, '#ffe27a'); gg.addColorStop(1, '#f2a516');
        g.fillStyle = gg;
      } else g.fillStyle = L.gen.color;
      g.fillText(str, genX, genY);
      const w = g.measureText(str).width;
      boxes.gen = { x: genX - w / 2, y: genY - s / 2, w, h: s };
    },
    pet() {
      // pet art (game picture / image folder), else a monogram medallion
      const bh = bottom - top;
      if (petImg) {
        const r = Math.min(bw / petImg.width, bh / petImg.height);
        const w = petImg.width * r, hh = petImg.height * r;
        const fx = recolor && mutated ? MUTATION_FX[mkey] : null;
        const pic = recolor && mutated && known ? tintPicture(petImg, w, hh, pal, mkey, mutIcon) : petImg;
        g.save();
        // glowing mutations get a coloured halo instead of the plain drop shadow
        if (fx && fx.glow) { g.shadowColor = fx.glow; g.shadowBlur = 38; g.shadowOffsetY = 0; }
        else { g.shadowColor = 'rgba(0,0,0,.65)'; g.shadowBlur = 28; g.shadowOffsetY = 14; }
        if (fx && fx.alpha) g.globalAlpha = fx.alpha;
        g.drawImage(pic, petX - w / 2, top + (bh - hh) / 2, w, hh);
        if (fx && fx.glow) { g.shadowBlur = 16; g.globalAlpha = 0.5; g.drawImage(pic, petX - w / 2, top + (bh - hh) / 2, w, hh); }
        g.restore();
      } else {
        const cy = (top + bottom) / 2, rad = Math.max(8, Math.min(120 * bw / 468, bh / 2 - 6));
        g.save(); g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 30;
        g.beginPath(); g.arc(petX, cy, rad, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,.06)'; g.fill(); g.restore();
        g.lineWidth = 5; g.strokeStyle = tint; g.beginPath(); g.arc(petX, cy, rad, 0, Math.PI * 2); g.stroke();
        const initials = String(pet.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
        g.fillStyle = '#fff'; g.font = `900 ${Math.round(rad * 0.8)}px Segoe UI`; g.fillText(initials, petX, cy + 4);
      }
      boxes.pet = { x: petX - bw / 2, y: top, w: bw, h: bh };
    },
    shop() {
      const s = Math.max(6, L.shop.size);
      if (!shopName) { boxes.shop = { x: shopX - 60, y: shopY - s / 2, w: 120, h: s, empty: true }; return; }
      const str = L.shop.upper ? shopName.toUpperCase() : shopName;
      text(str, shopX, shopY, s, 800, L.shop, 5 / 20);
      g.save(); g.globalAlpha = Math.min(1, Math.max(0, L.shop.alpha)); g.fillStyle = L.shop.color; g.fillText(str, shopX, shopY); g.restore();
      const w = g.measureText(str).width;
      boxes.shop = { x: shopX - w / 2, y: shopY - s / 2, w, h: s };
    }
  };
  for (const k of [...T.order].reverse()) if (L[k].visible) draw[k]();
  return { canvas: c, boxes };
}

function pill(g, x, y, w, hgt, fill, stroke) {
  const r = hgt / 2;
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hgt, r); g.arcTo(x + w, y + hgt, x, y + hgt, r); g.arcTo(x, y + hgt, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  g.fillStyle = fill; g.fill(); g.lineWidth = 2; g.strokeStyle = stroke; g.stroke();
}

// Mutation recolour, matched to the game's own mutated brainrots:
//  - MUTATION_LUTS: brightness -> colour maps (24 stops, dark -> light) learned from the wiki's
//    in-game pictures of the same brainrot plain and in every mutation (Mutations page), so a
//    pixel gets the colour that brightness has on a real mutated brainrot
//  - icon palette / MUTATION_COLORS: fallback for mutations without a learned map
//  - MUTATION_FX: what the game adds on top, as seen in those pictures: Radioactive hatch,
//    Cursed / Divine grids of glowing symbols, Candy dots, Eclipse glowing dots, sparkles,
//    Phantom/Crystal see-through, Yin Yang one half dark, Rainbow colour sweep
const MUTATION_LUTS = {"gold":[[87,63,15],[87,63,15],[95,70,17],[102,74,18],[105,77,19],[106,89,21],[120,89,24],[122,91,26],[167,134,45],[169,134,45],[194,135,40],[222,135,39],[222,136,39],[197,150,49],[197,155,49],[211,165,44],[223,179,44],[242,199,47],[242,200,47],[244,201,49],[244,203,59],[247,213,124],[247,213,124],[247,213,124]],"diamond":[[19,67,94],[19,67,94],[20,75,104],[20,81,110],[21,86,116],[26,101,134],[29,102,135],[30,104,138],[47,160,222],[47,161,223],[47,161,224],[47,162,224],[48,164,216],[53,187,216],[53,187,216],[54,187,216],[61,189,219],[61,207,230],[61,207,230],[72,209,231],[86,212,232],[159,222,239],[159,223,239],[160,223,240]],"bloodrot":[[40,12,13],[40,12,13],[45,13,13],[49,13,13],[49,13,13],[50,14,14],[53,14,15],[57,15,15],[69,16,16],[69,16,16],[69,16,17],[87,17,20],[112,19,24],[132,22,29],[133,22,29],[133,22,29],[140,22,32],[161,23,34],[161,23,36],[161,40,60],[172,48,63],[187,119,136],[187,119,136],[187,119,136]],"candy":[[108,28,111],[108,28,111],[121,28,124],[128,28,133],[131,28,137],[197,28,191],[210,28,208],[226,29,220],[240,29,230],[240,41,230],[199,77,194],[182,119,177],[182,132,177],[194,141,184],[218,142,201],[247,142,216],[255,151,226],[255,203,245],[255,207,251],[255,209,252],[255,221,255],[255,223,255],[255,225,255],[255,227,255]],"lava":[[98,36,15],[98,36,15],[111,38,16],[116,42,17],[120,43,18],[137,45,23],[139,46,24],[141,47,25],[225,47,33],[226,47,34],[227,48,34],[227,54,34],[227,70,35],[229,83,40],[230,84,40],[231,85,41],[232,86,41],[233,117,42],[254,128,43],[254,129,44],[255,146,45],[255,146,45],[255,146,45],[255,146,45]],"galaxy":[[27,14,71],[27,14,71],[27,14,73],[28,15,75],[28,15,76],[30,15,83],[32,15,91],[33,16,96],[37,17,106],[37,17,111],[40,17,113],[43,17,124],[44,17,126],[47,18,133],[47,18,134],[48,18,135],[48,19,136],[183,46,217],[252,46,239],[253,46,243],[255,63,243],[255,63,243],[255,63,243],[255,79,243]],"yin-yang":[[19,19,19],[19,19,19],[26,26,26],[32,32,32],[38,38,38],[44,44,44],[51,51,51],[57,57,57],[70,70,70],[89,89,89],[108,108,108],[128,128,128],[147,147,147],[167,167,167],[186,186,186],[205,205,205],[218,218,218],[222,222,222],[228,228,228],[232,232,232],[238,238,238],[242,242,242],[248,248,248],[252,252,252]],"radioactive":[[10,40,7],[14,52,8],[18,64,10],[22,76,11],[26,88,13],[30,100,14],[34,112,16],[38,124,17],[45,136,19],[55,149,22],[65,161,24],[75,174,27],[85,186,29],[95,199,32],[105,211,34],[115,224,37],[125,232,41],[136,235,46],[147,238,51],[157,241,56],[168,244,62],[178,247,67],[189,250,72],[200,253,77]],"cursed":[[14,4,4],[27,5,5],[40,6,6],[53,7,7],[65,8,8],[78,9,9],[91,10,10],[104,11,11],[117,13,13],[131,15,15],[145,16,16],[159,18,18],[173,20,20],[187,22,22],[201,23,23],[215,25,25],[224,29,29],[228,36,35],[232,43,40],[236,50,46],[241,56,52],[245,63,58],[249,70,63],[253,77,69]],"divine":[[78,74,22],[78,74,22],[91,87,27],[100,95,31],[105,100,34],[128,123,48],[139,135,54],[147,140,57],[201,188,103],[203,190,127],[211,195,190],[212,196,203],[212,197,203],[244,213,75],[248,215,62],[255,218,51],[255,222,51],[255,234,114],[255,238,135],[255,246,143],[255,248,170],[255,248,170],[255,248,170],[255,248,170]],"cyber":[[12,12,13],[12,13,13],[13,13,13],[13,13,13],[13,13,13],[13,13,13],[13,13,13],[13,13,13],[14,15,17],[14,18,22],[15,21,27],[15,21,27],[15,21,27],[16,23,30],[17,25,34],[18,28,38],[24,36,49],[24,36,51],[30,42,55],[37,47,59],[66,77,91],[86,96,112],[87,98,114],[93,102,118]],"phantom":[[12,12,12],[12,12,12],[12,12,12],[12,12,12],[12,12,12],[12,12,12],[12,12,12],[12,12,12],[13,13,13],[13,13,13],[13,13,13],[13,13,13],[13,13,13],[13,13,13],[13,13,13],[13,13,13],[13,13,13],[15,15,15],[21,23,24],[27,33,35],[58,60,64],[104,153,165],[113,160,169],[130,170,183]],"crystal":[[113,131,204],[113,131,204],[113,131,204],[113,131,205],[114,131,205],[115,132,205],[116,132,205],[119,132,205],[143,139,209],[144,140,210],[146,141,211],[151,143,212],[155,144,212],[166,156,217],[168,158,219],[171,161,221],[186,176,228],[211,204,238],[231,217,243],[245,228,245],[252,233,252],[255,247,255],[255,248,255],[255,250,255]],"eclipse":[[5,4,12],[7,5,16],[10,7,20],[12,8,23],[14,10,27],[16,12,30],[18,13,33],[20,14,36],[22,16,39],[24,18,42],[26,19,45],[28,21,48],[30,22,50],[33,24,54],[35,27,58],[38,29,63],[41,31,67],[45,34,71],[49,37,76],[96,80,128],[150,130,140],[215,195,150],[245,228,160],[255,240,172]]};
const MUTATION_FX = {
  gold: { shine: 0.3, sparkle: 5 }, diamond: { sparkle: 8, shine: 0.25 }, crystal: { sparkle: 9, alpha: 0.88 },
  rainbow: { rainbow: true }, galaxy: {}, lava: { glow: 'rgba(255,110,30,.45)' },
  radioactive: { hatch: 'rgba(20,70,14,.45)' }, divine: { glow: 'rgba(255,233,160,.5)', glyphs: { chars: '☉♃♄☽♆♇♁♀♂☿', color: 'rgba(255,255,240,.85)', glow: 'rgba(255,255,220,.9)' } },
  cyber: {}, candy: { dots: 'rgba(214,28,190,.9)' }, cursed: { glyphs: { chars: '♦☿♆✦♦⚚', color: 'rgba(255,90,70,.9)', glow: 'rgba(255,30,20,1)' } },
  bloodrot: {}, phantom: { alpha: 0.85 }, eclipse: { glow: 'rgba(120,96,200,.3)', night: true },
  'yin-yang': { split: true }
};
const ICON_PALETTE = new WeakMap();
function iconPalette(icon) {
  if (!icon) return null;
  if (ICON_PALETTE.has(icon)) return ICON_PALETTE.get(icon);
  const c = document.createElement('canvas'); c.width = c.height = 48;
  const g = c.getContext('2d'); g.drawImage(icon, 0, 0, 48, 48);
  const d = g.getImageData(0, 0, 48, 48).data, px = [];
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (l < 22) continue;   // black outline of the icon
    px.push([d[i], d[i + 1], d[i + 2], l]);
  }
  let pal = null;
  if (px.length > 30) {
    px.sort((a, b) => a[3] - b[3]);
    const at = q => { const s0 = Math.floor(q * (px.length - 1)), n = Math.max(1, Math.floor(px.length * 0.06)); let r = 0, gg = 0, b = 0, k = 0; for (let i = Math.max(0, s0 - n); i <= Math.min(px.length - 1, s0 + n); i++) { r += px[i][0]; gg += px[i][1]; b += px[i][2]; k++; } return [r / k, gg / k, b / k]; };
    pal = [at(0.04), at(0.35), at(0.7), at(0.97)];
  }
  ICON_PALETTE.set(icon, pal);
  return pal;
}
function hexRgb(x) { return [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)); }
function tintPicture(img, w, hgt, pal, mkey, icon) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(hgt));
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, c.width, c.height);
  const fx = MUTATION_FX[mkey] || {};
  // palette stops, dark -> light: the learned in-game map first
  const learned = MUTATION_LUTS[mkey] || null;
  let stops = learned || iconPalette(icon);
  if (!stops && pal) { const lo = hexRgb(pal[1]), hi = hexRgb(pal[0]); stops = [lo, hexRgb(mixHex(pal[1], pal[0], 0.45)), hi, hexRgb(mixHex(pal[0], '#ffffff', 0.55))]; }
  const id = g.getImageData(0, 0, c.width, c.height), d = id.data, W = c.width, H = c.height;
  const lerp = (a, b, t) => a + (b - a) * t;
  const map = l => {   // l 0..1 through the 4 stops
    const x = Math.min(0.9999, Math.max(0, l)) * (stops.length - 1), i = Math.floor(x), t = x - i;
    return [lerp(stops[i][0], stops[i + 1][0], t), lerp(stops[i][1], stops[i + 1][1], t), lerp(stops[i][2], stops[i + 1][2], t)];
  };
  let lo = 0, hi = 1, gamma = 1;
  if (learned) {
    const hist = new Uint32Array(256); let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 127) { hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++; n++; }
    if (n > 50) {
      let acc = 0, a = -1, b = -1;
      for (let v = 0; v < 256; v++) { acc += hist[v]; if (a < 0 && acc >= n * 0.02) a = v; if (b < 0 && acc >= n * 0.98) { b = v; break; } }
      // only widen a narrow range (dark or flat pictures); a picture already spread out stays as it is
      if (b - a < 200) { const mid = (a + b) / 2, half = Math.max(30, (b - a) / 2); lo = Math.max(0, (mid - half) / 255); hi = Math.min(1, (mid + half) / 255); const span = Math.max(0.2, hi - lo); lo = Math.max(0, Math.min(lo, 1 - span)); hi = lo + span; }
      // mostly-dark pictures: lift the middle so the body gets the mutation's main colour, not its shadow colour
      let acc2 = 0, med = 128; for (let v = 0; v < 256; v++) { acc2 += hist[v]; if (acc2 >= n / 2) { med = v; break; } }
      const m01 = Math.min(1, Math.max(0.01, (med / 255 - lo) / (hi - lo)));
      if (m01 < 0.45) gamma = Math.max(0.45, Math.log(0.45) / Math.log(m01));
    }
  }
  const hsl = (h, sat, l) => { const a = sat * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0) * 255, f(8) * 255, f(4) * 255]; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (!d[i + 3]) continue;
    let l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    if (!learned) l = Math.min(1, Math.max(0, (l - 0.5) * 1.15 + 0.52));   // learned maps already carry the game's contrast
    else { if (hi - lo < 1) l = Math.min(1, Math.max(0, (l - lo) / (hi - lo))); if (gamma !== 1) l = Math.pow(l, gamma); }
    let rgb;
    if (fx.rainbow) rgb = hsl(((x + y) / (W + H)) * 360 * 1.4 % 360, 0.85, 0.25 + l * 0.55);
    else if (fx.split) { const c = v => Math.min(1, Math.max(0, (v - 0.5) * 2.2 + 0.5)); rgb = map(x < W / 2 ? c(1 - l) * 0.9 : 0.25 + c(l) * 0.75); }   // yin-yang: one half black with white features, one half white
    else if (stops) rgb = map(l);
    else continue;
    const k = learned ? 1 : 0.9;   // learned maps replace the colour fully, like the game
    d[i] = lerp(d[i], rgb[0], k); d[i + 1] = lerp(d[i + 1], rgb[1], k); d[i + 2] = lerp(d[i + 2], rgb[2], k);
  }
  g.putImageData(id, 0, 0);
  // extras, clipped to the brainrot's own shape
  g.save(); g.globalCompositeOperation = 'source-atop';
  const rnd = (() => { let s0 = 1234567; return () => (s0 = (s0 * 16807) % 2147483647) / 2147483647; })();   // same pattern every time
  if (fx.shine) {
    const lg = g.createLinearGradient(0, 0, W, H);
    lg.addColorStop(0.25, 'rgba(255,255,255,0)'); lg.addColorStop(0.42, `rgba(255,255,255,${fx.shine})`); lg.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.fillStyle = lg; g.fillRect(0, 0, W, H);
  }
  if (fx.stars) for (let n = 0; n < fx.stars; n++) { const r = rnd() * 1.8 + 0.6; g.fillStyle = `rgba(255,255,255,${0.5 + rnd() * 0.5})`; g.beginPath(); g.arc(rnd() * W, rnd() * H, r, 0, Math.PI * 2); g.fill(); }
  if (fx.stripes) { g.globalAlpha = 0.28; g.fillStyle = '#ffffff'; for (let x = -H; x < W; x += 22) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + 10, H); g.lineTo(x + 10 + H, 0); g.lineTo(x + H, 0); g.fill(); } g.globalAlpha = 1; }
  const u = Math.max(2, Math.round(Math.min(W, H) / 60));   // pattern size follows the picture size
  if (fx.hatch) {   // Radioactive: dense diagonal hatch over the green
    g.strokeStyle = fx.hatch; g.lineWidth = u * 0.9;
    for (let x = -H; x < W + H; x += u * 2.4) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + H, 0); g.stroke(); }
  }
  if (fx.glyphs) {   // Cursed / Divine: the game's texture is a repeating grid of glowing symbols
    const { chars, color, glow } = fx.glyphs, step = u * 7, size = Math.round(u * 4.6);
    g.font = `700 ${size}px "Segoe UI Symbol", "Segoe UI", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = glow; g.shadowBlur = u * 2.2; g.fillStyle = color;
    let n = 0;
    for (let row = 0, y = step * 0.4; y < H + step; row++, y += step * 0.86) {
      for (let x = (row % 2 ? step / 2 : 0) + step * 0.3; x < W + step; x += step) {
        g.fillText(chars[(n++ * 7 + row * 3) % chars.length], x, y);
      }
    }
    g.shadowBlur = 0;
  }
  if (fx.dots) {   // Candy: small magenta sprinkles
    g.fillStyle = fx.dots;
    for (let n = 0; n < 70; n++) { const x = rnd() * W, y = rnd() * H; g.save(); g.translate(x, y); g.rotate(rnd() * Math.PI); g.fillRect(-u * 0.5, -u * 1.4, u, u * 2.8); g.restore(); }
  }
  if (fx.night) {
    g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = 1;
    for (let x = 0; x < W; x += u * 3.2) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y < H; y += u * 3.2) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    const pts = Array.from({ length: 7 }, () => [W * (0.1 + rnd() * 0.8), H * (0.1 + rnd() * 0.8)]);
    g.strokeStyle = 'rgba(225,215,255,.35)'; g.lineWidth = Math.max(1, u * 0.25);
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    g.font = `700 ${Math.round(u * 4.2)}px "Segoe UI Symbol", "Segoe UI", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(255,225,140,.9)'; g.shadowBlur = u * 1.6; g.fillStyle = 'rgba(240,215,150,.9)';
    pts.forEach(([x, y], i) => g.fillText(i % 3 === 0 ? '☾' : '✦', x, y));
    g.shadowBlur = 0;
  }
  g.restore();
  if (fx.sparkle) {   // 4-point sparkles on top (may poke out of the outline, like the game's shine)
    g.save(); g.globalCompositeOperation = 'source-over';
    for (let n = 0; n < fx.sparkle; n++) {
      let x, y, tries = 0;
      do { x = rnd() * W; y = rnd() * H; tries++; } while (tries < 20 && d[(Math.floor(y) * W + Math.floor(x)) * 4 + 3] < 200);
      const r = 4 + rnd() * 7; g.fillStyle = 'rgba(255,255,255,.95)';
      g.beginPath(); g.moveTo(x, y - r); g.quadraticCurveTo(x, y, x + r, y); g.quadraticCurveTo(x, y, x, y + r); g.quadraticCurveTo(x, y, x - r, y); g.quadraticCurveTo(x, y, x, y - r); g.fill();
    }
    g.restore();
  }
  return c;
}
function mixHex(a, b, t) {
  const p = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
