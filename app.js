const $ = (id) => document.getElementById(id);
const els = {
  provider: $('provider'), docs: $('docs'), providerNote: $('providerNote'), credentialFields: $('credentialFields'),
  passwordField: $('passwordField'), appPassword: $('appPassword'), clearAfter: $('clearAfter'), checkBtn: $('checkBtn'),
  lockWarning: $('lockWarning'), result: $('result'), resultProvider: $('resultProvider'), statusBadge: $('statusBadge'),
  httpStatus: $('httpStatus'), latency: $('latency'), checkedAt: $('checkedAt'), message: $('message'), details: $('details'),
  providerGrid: $('providerGrid'), serviceStatus: $('serviceStatus')
};
let config = null;

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}
function selectedProvider() { return config?.providers?.find((p) => p.id === els.provider.value); }
function updateDocs() {
  const p = selectedProvider();
  els.docs.href = p?.docs || '#';
  els.docs.textContent = p ? `${p.name} docs ↗` : 'Dokumentasi provider ↗';
  els.providerNote.textContent = p?.note || `Metode autentikasi: ${p?.authMode || 'API key'}`;
}
function renderCredentialFields() {
  const p = selectedProvider();
  const fields = p?.fields || [];
  els.credentialFields.innerHTML = fields.map((f) => `
    <div class="field credential-field">
      <label for="cred_${escapeHtml(f.id)}">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>
      <div class="secret-row">
        <input id="cred_${escapeHtml(f.id)}" data-cred="${escapeHtml(f.id)}" type="${escapeHtml(f.type || 'text')}" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(f.placeholder || '')}" value="${escapeHtml(f.value || '')}">
        ${f.type === 'password' ? `<button class="ghost reveal-btn" type="button" data-target="cred_${escapeHtml(f.id)}">Lihat</button>` : ''}
      </div>
    </div>`).join('');
  for (const btn of document.querySelectorAll('.reveal-btn')) {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      btn.textContent = reveal ? 'Sembunyikan' : 'Lihat';
    });
  }
}
function renderProviders() {
  els.provider.innerHTML = config.providers.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} — ${escapeHtml(p.category)}</option>`).join('');
  els.providerGrid.innerHTML = config.providers.map((p) => `<div class="provider-pill"><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.category)}</span><small>${escapeHtml(p.authMode || '')}</small></div>`).join('');
  updateDocs(); renderCredentialFields();
}
function badgeClass(code) {
  if (code === 'valid') return 'ok';
  if (['billing','rate_limited','forbidden'].includes(code)) return 'warn';
  if (['invalid','rejected'].includes(code)) return 'bad';
  return 'neutral';
}
function renderDetails(data) {
  const blocks = [];
  if (typeof data.count === 'number') blocks.push(`<div class="detail-block"><span>Jumlah terdeteksi</span><strong>${data.count}</strong></div>`);
  if (Array.isArray(data.sample) && data.sample.length) blocks.push(`<div class="detail-wide"><span>Contoh resource/model</span><div class="chips">${data.sample.map((x)=>`<code>${escapeHtml(x)}</code>`).join('')}</div></div>`);
  if (data.account && Object.keys(data.account).length) blocks.push(`<div class="detail-wide"><span>Akun</span><pre>${escapeHtml(JSON.stringify(data.account,null,2))}</pre></div>`);
  if (data.keyInfo && Object.keys(data.keyInfo).length) blocks.push(`<div class="detail-wide"><span>Info credential</span><pre>${escapeHtml(JSON.stringify(data.keyInfo,null,2))}</pre></div>`);
  els.details.innerHTML = blocks.join('');
}
function renderResult(data) {
  els.result.classList.remove('hidden');
  els.resultProvider.textContent = data.provider?.name || selectedProvider()?.name || '-';
  els.statusBadge.textContent = data.label || data.code || '-';
  els.statusBadge.className = `badge ${badgeClass(data.code)}`;
  els.httpStatus.textContent = data.httpStatus ?? '-';
  els.latency.textContent = Number.isFinite(data.latencyMs) ? `${data.latencyMs} ms` : '-';
  els.checkedAt.textContent = data.checkedAt ? new Date(data.checkedAt).toLocaleTimeString('id-ID') : '-';
  if (data.message) { els.message.textContent = data.message; els.message.classList.remove('hidden'); }
  else { els.message.textContent = ''; els.message.classList.add('hidden'); }
  renderDetails(data); els.result.scrollIntoView({behavior:'smooth',block:'start'});
}
function collectCredentials() {
  const credentials = {};
  for (const input of document.querySelectorAll('[data-cred]')) credentials[input.dataset.cred] = input.value.trim();
  return credentials;
}
function clearSecrets() {
  const p = selectedProvider();
  const secretIds = new Set((p?.fields || []).filter((f)=>f.type==='password').map((f)=>f.id));
  for (const input of document.querySelectorAll('[data-cred]')) if (secretIds.has(input.dataset.cred)) input.value = '';
}
async function checkKey() {
  const p = selectedProvider();
  const credentials = collectCredentials();
  for (const field of p?.fields || []) {
    if (field.required && !credentials[field.id]) { document.querySelector(`[data-cred="${field.id}"]`)?.focus(); return; }
  }
  if (config.passwordRequired && !els.appPassword.value) { els.appPassword.focus(); return; }
  els.checkBtn.disabled = true; els.checkBtn.textContent = 'Mengecek…';
  try {
    const headers = {'Content-Type':'application/json'};
    if (config.passwordRequired) headers['X-App-Password'] = els.appPassword.value;
    const res = await fetch('/api/check', {method:'POST', headers, body:JSON.stringify({provider:els.provider.value, credentials})});
    const data = await res.json();
    if (!res.ok && !data.provider) renderResult({provider:{name:p?.name||'Checker'},code:'rejected',label:`Error ${res.status}`,httpStatus:res.status,checkedAt:new Date().toISOString(),message:data.error||'Request gagal'});
    else renderResult(data);
  } catch (error) {
    renderResult({provider:{name:p?.name||'Checker'},code:'network_error',label:'Network error',checkedAt:new Date().toISOString(),message:error.message});
  } finally {
    if (els.clearAfter.checked) clearSecrets();
    els.checkBtn.disabled = false; els.checkBtn.textContent = 'Cek Credential';
  }
}
els.provider.addEventListener('change', ()=>{ updateDocs(); renderCredentialFields(); });
els.checkBtn.addEventListener('click', checkKey);
try {
  const res = await fetch('/api/config',{cache:'no-store'}); config = await res.json(); renderProviders();
  if (config.passwordRequired) els.passwordField.classList.remove('hidden');
  if (config.passwordRequired && !config.passwordConfigured) { els.lockWarning.classList.remove('hidden'); els.lockWarning.textContent='Checker dikunci. Tambahkan APP_PASSWORD di Railway Variables lalu redeploy.'; els.checkBtn.disabled=true; }
  els.serviceStatus.textContent = `${config.providers.length} provider/profile aktif · limit ${config.maxChecksPerMinute}/menit`;
} catch { els.serviceStatus.textContent='Gagal memuat konfigurasi'; }
