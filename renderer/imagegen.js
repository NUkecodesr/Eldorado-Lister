// Automatic listing image: 600x600 card drawn on a canvas, returned as a PNG data URL.
// The card is built from layers (background, pet picture, traits row, pet name, M/s label,
// shop name) placed by an image template (Templates -> Image Editor). Positions are % of the
// 600px canvas, centre-anchored. The built-in "Default" template is the classic Zotac card.
const MUTATION_COLORS = {
  none: ['#3a3022', '#15110c'], gold: ['#f6c343', '#6b4a06'], diamond: ['#8fe3ff', '#164a63'], rainbow: null,
  lava: ['#ff7a2f', '#5a1405'], galaxy: ['#9b6bff', '#1a0d4a'], candy: ['#ff8fd0', '#6a1a4a'], bloodrot: ['#d3243a', '#3a0509'],
  cyber: ['#33e6ff', '#062f3d'], cursed: ['#8a3dff', '#16052e'], divine: ['#ffe9a6', '#7a5a12'], radioactive: ['#9dff3a', '#1f3d05'],
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

// Mutation recolour, made to look like the game's mutated brainrots:
//  - palette: taken from the mutation's own game icon (dark -> light colours), else the
//    fallback MUTATION_COLORS pair
//  - gradient map: every pixel's brightness picks a colour from that palette, so shading and
//    detail stay but the whole brainrot takes the mutation's colours (like the game recolour)
//  - per-mutation extras (MUTATION_FX): rainbow sweep, stars, sparkles, stripes, glow, see-through
const MUTATION_FX = {
  gold: { shine: 0.35, sparkle: 6 }, diamond: { sparkle: 10, shine: 0.3 }, crystal: { sparkle: 8, alpha: 0.9 },
  rainbow: { rainbow: true }, galaxy: { stars: 70 }, lava: { glow: 'rgba(255,110,30,.75)' },
  radioactive: { glow: 'rgba(140,255,60,.8)' }, divine: { glow: 'rgba(255,233,160,.9)', sparkle: 6 },
  cyber: { glow: 'rgba(51,230,255,.7)', scan: true }, candy: { stripes: true }, cursed: { glow: 'rgba(138,61,255,.6)' },
  bloodrot: { glow: 'rgba(211,36,58,.55)' }, phantom: { alpha: 0.72 }, eclipse: { glow: 'rgba(91,77,187,.55)' },
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
  // palette stops, dark -> light
  let stops = iconPalette(icon);
  if (!stops && pal) { const lo = hexRgb(pal[1]), hi = hexRgb(pal[0]); stops = [lo, hexRgb(mixHex(pal[1], pal[0], 0.45)), hi, hexRgb(mixHex(pal[0], '#ffffff', 0.55))]; }
  if (mkey === 'yin-yang') stops = [[18, 18, 18], [70, 70, 70], [200, 200, 200], [250, 250, 250]];
  const id = g.getImageData(0, 0, c.width, c.height), d = id.data, W = c.width, H = c.height;
  const lerp = (a, b, t) => a + (b - a) * t;
  const map = l => {   // l 0..1 through the 4 stops
    const x = Math.min(0.9999, Math.max(0, l)) * (stops.length - 1), i = Math.floor(x), t = x - i;
    return [lerp(stops[i][0], stops[i + 1][0], t), lerp(stops[i][1], stops[i + 1][1], t), lerp(stops[i][2], stops[i + 1][2], t)];
  };
  const hsl = (h, sat, l) => { const a = sat * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0) * 255, f(8) * 255, f(4) * 255]; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (!d[i + 3]) continue;
    let l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    l = Math.min(1, Math.max(0, (l - 0.5) * 1.15 + 0.52));   // a little more contrast, like the game's shading
    let rgb;
    if (fx.rainbow) rgb = hsl(((x + y) / (W + H)) * 360 * 1.4 % 360, 0.85, 0.25 + l * 0.55);
    else if (fx.split) rgb = map(x < W / 2 ? l : 1 - l);   // yin-yang: one half inverted
    else if (stops) rgb = map(l);
    else continue;
    const k = 0.9;   // keep a touch of the original colour for detail
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
  if (fx.scan) { g.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1.5); }
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
