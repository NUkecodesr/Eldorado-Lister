// Sends the eldorado.gg cookies (and this browser's user agent, which Cloudflare ties its
// clearance cookie to) to Zotac Lister on 127.0.0.1. Pairs itself with the app, then keeps it
// in sync: on browser start, whenever an eldorado.gg cookie changes, and every 10 minutes.
importScripts('sync.js');

let timer = null;
chrome.cookies.onChanged.addListener(({ cookie }) => {
  if (!/(^|\.)eldorado\.gg$/.test(String(cookie.domain).replace(/^\./, ''))) return;
  if (/^(_ga|_gid|_gcl|_fbp|_ttp|_hj|ajs_|amp_|_clck|_clsk|intercom|__stripe|_uet|mp_|_tt_|ttcsid|_scid|_rdt|_pin|__hs|hubspot|_dd_s|OptanonConsent)/i.test(cookie.name)) return;
  clearTimeout(timer);
  timer = setTimeout(async () => { if ((await cfg()).auto) sync('cookie changed'); }, 3000);
});
chrome.runtime.onStartup.addListener(async () => { if ((await cfg()).auto) sync('browser start'); });
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('zotac-sync', { periodInMinutes: 10 }); sync('installed'); });
chrome.alarms.onAlarm.addListener(async a => { if (a.name === 'zotac-sync' && (await cfg()).auto) sync('timer'); });
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg && msg.type === 'sync') { sync('manual').then(reply); return true; }
  if (msg && msg.type === 'pair') { pair(msg.port || DEFAULT_PORT).then(() => sync('paired')).then(reply, e => reply({ ok: false, error: e.message })); return true; }
  return false;
});
