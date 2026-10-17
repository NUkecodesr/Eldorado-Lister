// 127.0.0.1-only HTTP server for the Zotac browser extension (cookie sync) and
// the in-game delivery agent. Both are gated by per-install tokens.
const http = require('http');
const crypto = require('crypto');

// analytics / tracking cookies change all the time and say nothing about the login
const NOISE = /^(_ga|_gid|_gcl|_fbp|_ttp|_hj|ajs_|amp_|_clck|_clsk|intercom|__stripe|_uet|mp_|_tt_|ttcsid|_scid|_rdt|_pin|__hs|hubspot|_dd_s|OptanonConsent)/i;
let lastCookieSig = '';

function startLocalServer({ store, bridge, delivery, importScan, onServerScan, onArt, wantRescan, onCookies, onAgentClosing }) {
  const port = store.get('settings').localPort || 47321;
  const server = http.createServer(async (req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-Zotac-Token' });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'OPTIONS') return send(204, {});
    const url = new URL(req.url, 'http://127.0.0.1');
    let body = {};
    if (req.method === 'POST') {
      const chunks = [];
      for await (const c of req) { chunks.push(c); if (chunks.length > 4000) break; }
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return send(400, { error: 'bad json' }); }
    }
    const token = req.headers['x-zotac-token'] || url.searchParams.get('token') || body.token;
    const s = store.get('settings');
    try {
      if (url.pathname === '/ping') return send(200, { ok: true, app: 'zotac-lister', bridge: bridge.state });

      // The extension pairs itself: only an extension page may ask (websites always send their own
      // Origin), and only through 127.0.0.1/localhost (blocks DNS-rebinding pages).
      if (url.pathname === '/extension/pair' && req.method === 'GET') {
        const origin = String(req.headers.origin || '');
        const host = String(req.headers.host || '');
        if (origin && !origin.startsWith('chrome-extension://')) return send(403, { error: 'only the Zotac extension can pair' });
        if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) return send(403, { error: 'bad host' });
        store.log('info', '[Extension] paired');
        return send(200, { ok: true, token: s.extensionToken, port });
      }

      if (url.pathname === '/extension/cookies' && req.method === 'POST') {
        if (token !== s.extensionToken) return send(401, { error: 'bad token' });
        const list = Array.isArray(body.cookies) ? body.cookies.filter(c => /eldorado\.gg$/.test(String(c.domain || '').replace(/^\./, '')) || !c.domain) : [];
        // Cloudflare's clearance cookie only works with the browser's own user agent
        const ua = typeof body.userAgent === 'string' && /Mozilla\//.test(body.userAgent) ? body.userAgent.slice(0, 400) : null;
        if (ua && ua !== s.bridgeUserAgent) { store.patchSettings({ bridgeUserAgent: ua }); bridge.setUserAgent(ua); lastCookieSig = ''; }
        const sig = crypto.createHash('sha1').update(list.filter(c => c && c.name && !NOISE.test(c.name)).map(c => c.name + '=' + c.value).sort().join(';')).digest('hex');
        if (sig === lastCookieSig && bridge.state === 'connected') return send(200, { ok: true, set: list.length, unchanged: true });
        const n = await bridge.setCookies(list);
        lastCookieSig = sig;
        store.log('info', `[Extension] synced ${n} cookies`);
        onCookies && onCookies(n);
        return send(200, { ok: true, set: n });
      }

      // Plot scanner (in-game script): replaces that account's available pets.
      if (url.pathname === '/scanner/import' && req.method === 'POST') {
        if (token !== s.agentToken) return send(401, { error: 'bad token' });
        if (!body || !Array.isArray(body.pets)) return send(400, { error: 'pets[] missing' });
        return send(200, { ok: true, ...importScan(body) });
      }

      // Server scan (in-game script): every base in the Roblox server the scanner is in. Read only,
      // kept for the Server Scan page, never mixed into your own pets.
      // the scanner asks every few seconds whether Auto Scan wants a fresh scan of its account
      if (url.pathname === '/scanner/wanted' && req.method === 'GET') {
        if (token !== s.agentToken) return send(401, { error: 'bad token' });
        return send(200, { rescan: !!(wantRescan && wantRescan(url.searchParams.get('account') || '')) });
      }

      if (url.pathname === '/scanner/art' && req.method === 'POST') {
        if (token !== s.agentToken) return send(401, { error: 'bad token' });
        if (body && body.art && onArt) onArt(body.art);
        return send(200, { ok: true });
      }

      if (url.pathname === '/scanner/server' && req.method === 'POST') {
        if (token !== s.agentToken) return send(401, { error: 'bad token' });
        if (!body || !Array.isArray(body.bases)) return send(400, { error: 'bases[] missing' });
        onServerScan && onServerScan(body);
        return send(200, { ok: true, bases: body.bases.length });
      }

      if (url.pathname.startsWith('/agent/')) {
        if (token !== s.agentToken) return send(401, { error: 'bad token' });
        // In-game heartbeat (scanner script): marks the account's client as running.
        if (url.pathname === '/agent/heartbeat') {
          const acc = String(body.account || url.searchParams.get('account') || '');
          if (acc && body.closing) {   // client is closing: offline now, so a new job relaunches it right away
            delete delivery.lastSeen[acc.toLowerCase()];
            if (onAgentClosing) setTimeout(() => onAgentClosing(acc), 2500);   // then end the Roblox process itself
            for (const k of Object.keys(delivery.lastAgentPoll)) if (k.toLowerCase() === acc.toLowerCase()) delete delivery.lastAgentPoll[k];
          } else if (acc) delivery.lastSeen[acc.toLowerCase()] = Date.now();
          return send(200, { ok: true });
        }
        if (url.pathname === '/agent/jobs' && req.method === 'GET') {
          const job = delivery.nextJob(url.searchParams.get('account') || '');
          return send(200, { job });
        }
        const m = url.pathname.match(/^\/agent\/jobs\/(\w+)$/);
        // agent checks its job is still wanted while it waits (cancelled = stop before trading)
        if (m && req.method === 'GET') return send(200, { status: delivery.jobStatus(m[1]) });
        const ev = url.pathname.match(/^\/agent\/jobs\/(\w+)\/event$/);
        if (ev && req.method === 'POST') return send(200, { ok: await delivery.jobEvent(ev[1], body) });
        if (m && req.method === 'POST') {
          const ok = await delivery.jobResult(m[1], body.status === 'done' || body.ok === true, body.reason || body.message, { moved: body.moved });
          return send(ok ? 200 : 404, { ok });
        }
        if (url.pathname === '/agent/log' && req.method === 'POST') {
          store.log(body.level || 'info', '[Agent] ' + String(body.message || '').slice(0, 500));
          return send(200, { ok: true });
        }
      }
      return send(404, { error: 'not found' });
    } catch (e) {
      return send(500, { error: e.message });
    }
  });
  server.on('error', e => store.log('error', `[LocalServer] ${e.message}`));
  server.listen(port, '127.0.0.1');
  return server;
}

module.exports = { startLocalServer };
