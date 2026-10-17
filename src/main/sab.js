// Steal a Brainrot domain helpers: gen/s parsing, Eldorado attribute mapping,
// pet JSON import normalisation.

const UNITS = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };

// "62.5M/s", "62.5m", "1.2B", 62500000, "$62.5M/s" -> 62500000
function parseGen(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[$,\s]/g, '').replace(/\/s$/i, '');
  const m = s.match(/^(-?\d+(?:\.\d+)?)([kmbt])?/i);
  if (!m) return 0;
  return parseFloat(m[1]) * (m[2] ? UNITS[m[2].toLowerCase()] : 1);
}

function formatGen(n) {
  n = Number(n) || 0;
  const fmt = (x, u) => `${+(x).toFixed(x >= 100 ? 1 : 2)}${u}/s`;
  if (n >= 1e12) return fmt(n / 1e12, 'T');
  if (n >= 1e9) return fmt(n / 1e9, 'B');
  if (n >= 1e6) return fmt(n / 1e6, 'M');
  if (n >= 1e3) return fmt(n / 1e3, 'K');
  return `${n}/s`;
}

// Eldorado "M/s" select bucket for a raw gen value.
function genBucket(n) {
  const M = 1e6, B = 1e9;
  if (!n || n <= 0) return '0';
  if (n < M) return '0-99999-ks';
  if (n < 25 * M) return '1-2499-ms';
  if (n < 50 * M) return '25-4999-ms';
  if (n < 100 * M) return '50-9999-ms';
  if (n < 250 * M) return '100-24999-ms';
  if (n < 500 * M) return '250-49999-ms';
  if (n < 750 * M) return '500-74999-ms';
  if (n < B) return '750-99999-ms';
  if (n < 5 * B) return '1-499-bs';
  if (n < 10 * B) return '5-999-bs';
  if (n < 20 * B) return '10-1999-bs';
  return '20-plus-bs';
}

const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-');
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function mutationId(m, metaValues) {
  const raw = String(m || '').trim();
  if (!raw || /^(none|normal|default|base|-)$/i.test(raw)) return 'none';
  if (metaValues && metaValues.length) {
    const hit = metaValues.find(v => norm(v.name) === norm(raw) || norm(v.id) === norm(raw));
    if (hit) return hit.id;
  }
  return slug(raw);
}

function traitIds(traits, metaValues) {
  const list = Array.isArray(traits) ? traits : String(traits || '').split(/[,;|]/);
  const out = [];
  for (const t of list.map(x => String(x).trim()).filter(Boolean)) {
    const hit = (metaValues || []).find(v => norm(v.name) === norm(t) || norm(v.id) === norm(t));
    if (hit && !out.includes(hit.id)) out.push(hit.id);
  }
  return out;
}

// Flatten the library tradeEnvironments tree into { name -> {id, rarity, image} }.
function buildItemIndex(library, itemTypeValue = 'Brainrot') {
  const idx = new Map();
  const roots = (library && library.tradeEnvironments) || [];
  const root = roots.find(r => r.value === itemTypeValue) || roots[0];
  if (!root) return idx;
  for (const rarity of root.childTradeEnvironments || []) {
    for (const item of rarity.childTradeEnvironments || []) {
      const rec = { id: item.id, name: item.value, rarity: rarity.value, image: item.imageLocation };
      idx.set(norm(item.value), rec);
    }
    if (!(rarity.childTradeEnvironments || []).length) idx.set(norm(rarity.value), { id: rarity.id, name: rarity.value, rarity: rarity.value });
  }
  return idx;
}

function findItem(idx, name) {
  const k = norm(name);
  if (idx.has(k)) return idx.get(k);
  // loose match: startsWith / contains
  for (const [key, v] of idx) if (key.length > 4 && (k.startsWith(key) || key.startsWith(k))) return v;
  return null;
}

// --- Pet JSON import ------------------------------------------------------
const pick = (o, keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return undefined; };

function petFromAny(o, accountName) {
  if (!o || typeof o !== 'object') return null;
  // Eldorado offer export (results[].offer or offer object)
  const offer = o.offer && o.offer.tradeEnvironmentValues ? o.offer : (o.tradeEnvironmentValues ? o : null);
  if (offer) {
    const env = (offer.tradeEnvironmentValues || []);
    const name = (env.find(e => /brainrot|item/i.test(e.name) && e.id && e.id.split('-').length === 3) || env[env.length - 1] || {}).value;
    const attrs = offer.attributes || [];
    const mut = attrs.find(a => /mutation/i.test(a.id));
    const num = attrs.find(a => a.type === 'Numeric');
    const traits = attrs.find(a => /trait/i.test(a.id));
    return {
      name, mutation: mut && mut.value ? mut.value.name : 'None',
      gen: num ? Number(num.value) : 0,
      traits: traits && traits.values ? traits.values.map(v => v.name) : [],
      rarity: (env.find(e => /rarity/i.test(e.name)) || {}).value,
      price: offer.pricePerUnit ? offer.pricePerUnit.amount : undefined,
      account: accountName,
      offerId: offer.id, quantity: offer.quantity || 1
    };
  }
  const name = pick(o, ['name', 'Name', 'petName', 'PetName', 'DisplayName', 'displayName', 'brainrot', 'Brainrot', 'pet', 'Pet', 'item']);
  if (!name || typeof name !== 'string') return null;
  const genRaw = pick(o, ['gen', 'Gen', 'generation', 'Generation', 'genPerSec', 'gps', 'income', 'Income', 'moneyPerSec', 'MoneyPerSecond', 'ms', 'M/s', 'value', 'cash']);
  let traits = pick(o, ['traits', 'Traits', 'trait', 'Trait', 'modifiers']);
  if (traits && !Array.isArray(traits)) traits = String(traits).split(/[,;|]/).map(s => s.trim()).filter(Boolean);
  return {
    name: name.trim(),
    mutation: pick(o, ['mutation', 'Mutation', 'mut', 'variant', 'Variant']) || 'None',
    gen: parseGen(genRaw),
    traits: traits || [],
    rarity: pick(o, ['rarity', 'Rarity']),
    cost: Number(pick(o, ['cost', 'Cost', 'paid', 'buyPrice'])) || 0,
    account: pick(o, ['account', 'Account', 'owner', 'Owner', 'username', 'Username', 'player', 'Player']) || accountName,
    quantity: Number(pick(o, ['quantity', 'qty', 'amount', 'count'])) || 1
  };
}

// Accepts: array of pets | {pets:[...]} | {username, pets} | {accounts:{name:[pets]}} | {name:[pets]} | Eldorado {results:[{offer}]}
function normalizePetImport(json, defaultAccount = '') {
  const out = [];
  const walk = (node, acct) => {
    if (Array.isArray(node)) { node.forEach(n => walk(n, acct)); return; }
    if (!node || typeof node !== 'object') return;
    // a container ({username, displayName, pets:[...]}) is never a pet itself, even though
    // displayName/username look like a pet name
    const CONTAINER = ['pets', 'Pets', 'brainrots', 'Brainrots', 'items', 'inventory', 'Inventory'];
    if (CONTAINER.some(k => Array.isArray(node[k]))) {
      const acctName = pick(node, ['username', 'Username', 'account', 'player']) || acct;
      for (const k of CONTAINER) if (Array.isArray(node[k])) { walk(node[k], typeof acctName === 'string' ? acctName : acct); return; }
    }
    const p = petFromAny(node, acct);
    if (p) { for (let i = 0; i < Math.max(1, Math.min(p.quantity || 1, 50)); i++) out.push({ ...p }); return; }
    const acctName = pick(node, ['username', 'Username', 'account', 'player', 'name']) || acct;
    for (const key of ['pets', 'Pets', 'brainrots', 'Brainrots', 'items', 'results', 'inventory', 'Inventory', 'data']) {
      if (node[key]) { walk(node[key], typeof acctName === 'string' ? acctName : acct); return; }
    }
    if (node.accounts && typeof node.accounts === 'object') {
      for (const [k, v] of Object.entries(node.accounts)) walk(v, Array.isArray(v) ? k : (v.username || k));
      return;
    }
    // map of account -> pets
    for (const [k, v] of Object.entries(node)) if (Array.isArray(v)) walk(v, k);
  };
  walk(json, defaultAccount);
  return out.filter(p => p.name);
}

function fillTemplate(tpl, pet, extra = {}) {
  // {mutation} is empty for unmutated pets so "{mutation} {name} | {gen}" reads cleanly
  const mutation = pet.mutation && !/^(none|normal)$/i.test(pet.mutation) ? pet.mutation : '';
  const vars = {
    name: pet.name || '',
    mutation,
    mutationTag: mutation ? `[${mutation}] ` : '',
    gen: formatGen(pet.gen),
    genRaw: String(pet.gen || 0),
    traits: (pet.traits || []).join(', '),
    rarity: pet.rarity || '',
    emoji: '🔥',
    account: '',
    price: pet.price != null ? Number(pet.price).toFixed(2) : ''
  };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null) vars[k] = v;
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m))
    .replace(/ {2,}/g, ' ').replace(/^ +| +$/gm, '')
    .replace(/([ \t]*\|)+[ \t]*$/gm, '').replace(/^[ \t]*\|[ \t]*/gm, '').trim();
}

// the exact same brainrot (name, mutation, gen/s, traits): one offer, interchangeable in a sale
function petKey(p) {
  return [norm(p.name), norm(p.mutation || 'None'), Math.round(Number(p.gen) || 0), (p.traits || []).map(norm).sort().join(',')].join('|');
}

module.exports = { parseGen, formatGen, genBucket, mutationId, traitIds, buildItemIndex, findItem, normalizePetImport, fillTemplate, norm, slug, petKey };
