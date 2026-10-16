const $ = id => document.getElementById(id);
const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago'; };

function show(last) {
  const el = $('st');
  if (!last) { el.className = 'st'; el.textContent = 'Not synced yet'; return; }
  el.className = 'st ' + (last.ok ? 'ok' : 'bad');
  el.textContent = last.ok ? `Synced ${last.n} cookies · ${ago(last.at)}` : `${last.error} · ${ago(last.at)}`;
}

chrome.storage.local.get(['token', 'port', 'auto', 'last'], v => {
  $('token').value = v.token || '';
  $('port').value = v.port || '47321';
  $('auto').checked = v.auto !== false;
  show(v.last);
});

$('auto').onchange = () => chrome.storage.local.set({ auto: $('auto').checked });
$('port').onchange = () => chrome.storage.local.set({ port: $('port').value.trim() || '47321' });
$('token').onchange = () => chrome.storage.local.set({ token: $('token').value.trim() });
$('sync').onclick = async () => { $('st').textContent = 'Syncing…'; show(await chrome.runtime.sendMessage({ type: 'sync' })); };
$('pair').onclick = async () => {
  $('st').textContent = 'Pairing…';
  const r = await chrome.runtime.sendMessage({ type: 'pair', port: $('port').value.trim() || '47321' });
  show(r);
  chrome.storage.local.get(['token'], v => { $('token').value = v.token || ''; });
};
