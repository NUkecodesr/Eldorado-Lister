const $ = id => document.getElementById(id);
const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago'; };

function show(last, busy) {
  const el = $('st');
  if (busy) { el.className = 'status'; $('stT').textContent = busy; $('stS').textContent = ''; return; }
  if (!last) { el.className = 'status'; $('stT').textContent = 'Not synced yet'; $('stS').textContent = 'Press Sync now'; return; }
  el.className = 'status ' + (last.ok ? 'ok' : 'bad');
  $('stT').textContent = last.ok ? `Connected · ${last.n} cookies synced` : 'Not synced';
  $('stS').textContent = last.ok ? `Last sync ${ago(last.at)}` : `${last.error} · ${ago(last.at)}`;
}

$('ver').textContent = 'v' + chrome.runtime.getManifest().version + ' · keeps Zotac Lister logged in';
chrome.storage.local.get(['token', 'port', 'auto', 'last'], v => {
  $('token').value = v.token || '';
  $('port').value = v.port || '47321';
  $('auto').checked = v.auto !== false;
  show(v.last);
});

$('auto').onchange = () => chrome.storage.local.set({ auto: $('auto').checked });
$('port').onchange = () => chrome.storage.local.set({ port: $('port').value.trim() || '47321' });
$('token').onchange = () => chrome.storage.local.set({ token: $('token').value.trim() });
$('sync').onclick = async () => {
  $('sync').disabled = true; show(null, 'Syncing…');
  show(await sync('manual'));   // runs right here, so it works even before the background worker starts
  $('sync').disabled = false;
};
$('pair').onclick = async () => {
  $('pair').disabled = true; show(null, 'Pairing…');
  const port = $('port').value.trim() || '47321';
  try { await pair(port); show(await sync('paired')); }
  catch (e) { show({ ok: false, at: Date.now(), error: /fetch|timed? ?out|abort/i.test(e.message) ? 'Zotac Lister is not running (port ' + port + ')' : e.message }); }
  chrome.storage.local.get(['token'], v => { $('token').value = v.token || ''; });
  $('pair').disabled = false;
};
