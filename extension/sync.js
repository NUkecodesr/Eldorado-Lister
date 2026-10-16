// Shared by the background worker and the popup: pairing with Zotac Lister and sending it the
// eldorado.gg cookies plus this browser's user agent (Cloudflare ties its clearance cookie to it).
const DEFAULT_PORT = '47321';

async function cfg() {
  const v = await chrome.storage.local.get(['token', 'port', 'auto', 'last']);
  return { token: v.token || '', port: v.port || DEFAULT_PORT, auto: v.auto !== false, last: v.last || null };
}

// the app hands its token only to extension pages (websites cannot send a chrome-extension:// origin)
async function pair(port) {
  const r = await fetch(`http://127.0.0.1:${port}/extension/pair`, { signal: AbortSignal.timeout(8000) });
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
      method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', 'X-Zotac-Token': t },
      body: JSON.stringify({ cookies, userAgent: navigator.userAgent })
    });
    let r = await send(token);
    if (r.status === 401) { token = await pair(c.port); r = await send(token); }   // token was changed in the app
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    last = { ok: true, at: Date.now(), n: j.set, reason };
  } catch (e) {
    last = { ok: false, at: Date.now(), error: /fetch|timed? ?out|abort/i.test(e.message) ? 'Zotac Lister is not running (port ' + c.port + ')' : e.message, reason };
  }
  await chrome.storage.local.set({ last });
  try { chrome.action.setBadgeText({ text: last.ok ? '' : '!' }); chrome.action.setBadgeBackgroundColor({ color: '#d33' }); } catch { /* no badge */ }
  return last;
}

