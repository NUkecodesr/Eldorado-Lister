const $ = id => document.getElementById(id);
chrome.storage.local.get(['token', 'port'], v => { if (v.token) $('token').value = v.token; if (v.port) $('port').value = v.port; });
$('sync').onclick = async () => {
  const token = $('token').value.trim(), port = $('port').value.trim() || '47321';
  chrome.storage.local.set({ token, port });
  try {
    const cookies = (await chrome.cookies.getAll({ domain: 'eldorado.gg' })).map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, expirationDate: c.expirationDate }));
    const r = await fetch(`http://127.0.0.1:${port}/extension/cookies`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Zotac-Token': token }, body: JSON.stringify({ cookies }) });
    const j = await r.json();
    $('s').textContent = r.ok ? `Synced ${j.set} cookies` : 'Error: ' + (j.error || r.status);
  } catch (e) { $('s').textContent = 'Zotac not reachable: ' + e.message; }
};
