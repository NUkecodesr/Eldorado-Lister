// 127.0.0.1-only HTTP server for the Zotac browser extension (cookie sync) and
// the in-game delivery agent. Both are gated by per-install tokens.
const http = require('http');

function startLocalServer({ store, bridge, delivery, importScan, onCookies, onAgentClosing }) {
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

      if (url.pathname === '/extension/cookies' && req.method === 'POST') {
        if (token !== s.extensionToken) return send(401, { error: 'bad token' });
        const list = Array.isArray(body.cookies) ? body.cookies.filter(c => /eldorado\.gg$/.test(String(c.domain || '').replace(/^\./, '')) || !c.domain) : [];
        const n = await bridge.setCookies(list);
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
        if (m && req.method === 'POST') {
          const ok = await delivery.jobResult(m[1], body.status === 'done' || body.ok === true, body.reason || body.message);
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
