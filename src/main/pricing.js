// Smart Auto Price: price a pet from live competitor offers, scaled by real gen/s.
const sab = require('./sab');
const { listOf, DELIVERY_ORDER, round2 } = require('./eldorado');

function compFromResult(r, numericAttr, mutationAttr) {
  const o = r.offer || r;
  const attrs = o.attributes || [];
  const num = attrs.find(a => a.id === numericAttr) || attrs.find(a => a.type === 'Numeric');
  const mut = attrs.find(a => a.id === mutationAttr);
  const info = r.userOrderInfo || {};
  return {
    id: o.id,
    title: o.offerTitle,
    price: (o.pricePerUnitInUSD || o.pricePerUnit || {}).amount,
    gen: num ? Number(num.value) : 0,
    mutation: mut && mut.value ? mut.value.id : null,
    quantity: o.quantity,
    delivery: o.guaranteedDeliveryTime,
    seller: r.user ? r.user.username : '',
    sellerId: o.userId || (r.user && r.user.id),
    verified: r.user ? !!r.user.isVerifiedSeller : false,
    feedback: info.feedbackScore != null ? Number(info.feedbackScore) : null,
    ratings: info.ratingCount != null ? info.ratingCount : null,
    medianDelivery: r.deliveryTime ? r.deliveryTime.deliveryTimeMedian : null
  };
}

function passesRules(c, rules, myId) {
  if (rules.ignoreOwn && myId && c.sellerId === myId) return false;
  if (Array.isArray(rules.deliveryTimes) && rules.deliveryTimes.length) {
    // explicit list from the Listing Rules multi-select
    if (!rules.deliveryTimes.includes(c.delivery)) return false;
  } else {
    const maxIdx = DELIVERY_ORDER.indexOf(rules.maxDeliveryTime || 'Day100');
    const idx = DELIVERY_ORDER.indexOf(c.delivery);
    if (maxIdx >= 0 && idx > maxIdx) return false;
  }
  if (rules.minFeedback && c.feedback != null && c.feedback < rules.minFeedback) return false;
  if (rules.minRatings && (c.ratings || 0) < rules.minRatings) return false;
  const words = (Array.isArray(rules.ignoreTitleWords) ? rules.ignoreTitleWords : String(rules.ignoreTitleWords || '').split(',')).map(s => String(s).trim().toLowerCase()).filter(Boolean);
  if (words.length && words.some(w => String(c.title || '').toLowerCase().includes(w))) return false;
  return c.price > 0;
}

const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };

async function smartPrice(eld, pet, settings, myId) {
  const g = settings.game;
  const al = settings.autolist;
  const rules = settings.rules;
  const idx = await eld.itemIndex();
  const item = sab.findItem(idx, pet.name);
  if (!item) return { price: null, basis: 'unknown item', comps: [] };
  const mutation = sab.mutationId(pet.mutation, eld.attrValues(g.mutationAttr));
  const res = await eld.searchMarket({ name: item.name, mutation, sort: 'priceAsc', pageSize: 48 });
  const all = listOf(res).map(r => compFromResult(r, g.msNumericAttr, g.mutationAttr));
  const comps = all.filter(c => passesRules(c, rules, myId));
  // generation tolerance: ± M/s (0 = exact, tiny slack for float/rounding) or ± %
  const byMs = al.genTolMode === 'ms';
  const tolAbs = Math.max(0, Number(al.genToleranceMs) || 0) * 1e6;
  const tol = (al.genTolerancePct === '' || al.genTolerancePct == null ? 15 : Math.max(0, Number(al.genTolerancePct) || 0)) / 100;
  const isNear = c => c.gen > 0 && pet.gen > 0 && (byMs ? Math.abs(c.gen - pet.gen) <= tolAbs + pet.gen * 0.001 : Math.abs(c.gen - pet.gen) / pet.gen <= tol + 0.001);
  const tolLabel = byMs ? (tolAbs ? `±${tolAbs / 1e6} M/s` : 'exact M/s') : `±${Math.round(tol * 100)}%`;
  const near = comps.filter(isNear);
  // Too few listings like this pet (same item + mutation within the gen tolerance): any price would
  // be a guess from other gens or the $/M/s fallback, usually far too low for a rare pet. Unless the
  // seller chose the estimate, it goes to Manual Review and the seller sets the price.
  const minComps = Math.max(1, Math.round(Number(al.minComps) || 1));
  if (near.length < minComps && al.noCompsMode !== 'estimate') {
    return { price: null, review: true, basis: `no similar listings (${near.length} within ${tolLabel} gen${minComps > 1 ? `, need ${minComps}` : ''}, ${comps.length} of this item) - set the price yourself`, comps: comps.slice(0, 15), item, totalMarket: res && res.recordCount };
  }
  let price, basis, ladder = [], ignored = [];
  if (near.length) {
    // each similar offer as a price for our gen: a comparable with more gen/s is scaled down to ours,
    // never up (the cheapest one decides, as before)
    const eff = c => c.gen > 0 && pet.gen > 0 ? Math.min(c.price, c.price * (pet.gen / c.gen)) : c.price;
    let list = near.map(c => ({ v: eff(c), price: c.price, seller: c.seller, gen: c.gen })).sort((a, b) => a.price - b.price);
    // lowball guard: with 3+ similar offers, one far under their median is a dump or bait, not the
    // market, and is ignored instead of dragging the price down (rules.lowballPct, 0 = off)
    const guard = lowballGuard(rules);
    if (guard && list.length >= 3) {
      const m = median(list.map(x => x.v));
      ignored = list.filter(x => x.v < m * (1 - guard));
      list = list.filter(x => x.v >= m * (1 - guard));
    }
    ladder = list;
    const ref = ladder[0];
    price = ref.v - (al.undercut || 0);
    basis = `${near.length} comps within ${tolLabel} gen, cheapest $${ref.price}${ref.seller ? ' (@' + ref.seller + ')' : ''}`
      + (ignored.length ? `, ignored ${ignored.length} lowball (${ignored.map(x => '$' + x.price + (x.seller ? ' @' + x.seller : '')).join(', ')})` : '');
  } else if (comps.some(c => c.gen > 0) && pet.gen > 0) {
    const rates = comps.filter(c => c.gen > 0).map(c => c.price / c.gen);
    const rate = Math.min(median(rates), Math.min(...rates) * 1.5);
    price = rate * pet.gen - (al.undercut || 0);
    basis = `gen-scaled from ${rates.length} comps ($${(rate * 1e6).toFixed(4)} per M/s)`;
  } else if (comps.length) {
    price = Math.min(...comps.map(c => c.price)) - (al.undercut || 0);
    basis = `cheapest of ${comps.length} same-item offers (no gen data)`;
  } else {
    price = (al.fallbackPerMillion || 0.05) * (pet.gen / 1e6);
    basis = 'no comps — fallback $/M/s';
  }
  price = Math.max(al.minPrice || 0.5, Math.min(al.maxPrice || 99999, price));
  return { price: round2(price), basis, comps: comps.slice(0, 15), ladder, ignored, item, totalMarket: res && res.recordCount };
}
// share of the market price under which a similar offer counts as a lowball (0..0.9; default 40 %)
function lowballGuard(rules) {
  const v = rules && rules.lowballPct;
  return Math.min(90, Math.max(0, v === '' || v == null ? 40 : Number(v) || 0)) / 100;
}

module.exports = { smartPrice, compFromResult, passesRules, lowballGuard };
