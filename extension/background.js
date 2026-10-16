// Sends the eldorado.gg cookies (and this browser's user agent, which Cloudflare ties its
// clearance cookie to) to Zotac Lister on 127.0.0.1. Pairs itself with the app, then keeps it
// in sync: on browser start, whenever an eldorado.gg cookie changes, and every 10 minutes.
const DEFAULT_PORT = '47321';

async function cfg() {
  const v = await chrome.storage.local.get(['token', 'port', 'auto', 'last']);
  return { token: v.token || '', port: v.port || DEFAULT_PORT, auto: v.auto !== false, last: v.last || null };
}

// the app hands its token only to extension pages (websites cannot send a chrome-extension:// origin)
async function pair(port) {
  const r = await fetch(`http://127.0.0.1:${port}/extension/pair`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) throw new Error(j.error || 'pairing refused (HTTP ' + r.status + ')');
  await chrome.storage.local.set({ token: j.token, port: String(j.port || port) });
  return j.token;
}

async function sync(reason) {
  const c = await cfg();
  let last;
  try {
    let token = c.token;
    if (!token) token = await pair(c.port);
    const cookies = (await chrome.cookies.getAll({ domain: 'eldorado.gg' })).map(x => ({
      name: x.name, value: x.value, domain: x.domain, hostOnly: x.hostOnly, path: x.path, secure: x.secure,
      httpOnly: x.httpOnly, sameSite: x.sameSite, expirationDate: x.expirationDate
    }));
    if (!cookies.length) throw new Error('no eldorado.gg cookies: log in on eldorado.gg in this browser first');
    const send = t => fetch(`http://127.0.0.1:${c.port}/extension/cookies`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Zotac-Token': t },
      body: JSON.stringify({ cookies, userAgent: navigator.userAgent })
    });
    let r = await send(token);
    if (r.status === 401) { token = await pair(c.port); r = await send(token); }   // token was changed in the app
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    last = { ok: true, at: Date.now(), n: j.set, reason };
  } catch (e) {
    last = { ok: false, at: Date.now(), error: /fetch/i.test(e.message) ? 'Zotac Lister is not running (port ' + c.port + ')' : e.message, reason };
  }
  await chrome.storage.local.set({ last });
  chrome.action.setBadgeText({ text: last.ok ? '' : '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#d33' });
  return last;
}

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
