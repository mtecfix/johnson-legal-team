// Client dashboard — consumes the isolated portal API via window.PortalAPI.
// All data is fetched with the caller's Cognito token; the server scopes every
// response to the authenticated user, so this page only ever shows the current
// client's own data.
'use strict';

document.addEventListener('DOMContentLoaded', () => {
  if (!window.PortalAPI) { showError('API client not loaded.'); return; }
  document.getElementById('logoutBtn').addEventListener('click', (e) => { e.preventDefault(); logout(); });
  document.getElementById('sendMessageBtn').addEventListener('click', sendMessage);
  loadAll();
});

async function loadAll() {
  toggleLoading(true);
  // Load independently so one failure doesn't blank the whole dashboard.
  await Promise.allSettled([
    loadProfile(), loadCases(), loadDocuments(),
    loadMessages(), loadInvoices(), loadAppointments(),
  ]);
  toggleLoading(false);
}

async function loadProfile() {
  try {
    const { profile } = await PortalAPI.getProfile();
    if (!profile) { setHtml('profileInfo', '<p class="text-muted mb-0">No profile on file yet.</p>'); return; }
    document.getElementById('userGreeting').textContent = `Welcome, ${esc(profile.first_name || 'Client')}`;
    setHtml('profileInfo', `
      <p class="mb-1"><strong>Name:</strong> ${esc(profile.first_name)} ${esc(profile.last_name)}</p>
      <p class="mb-1"><strong>Email:</strong> ${esc(profile.email)}</p>
      <p class="mb-0"><strong>Phone:</strong> ${esc(profile.phone || '—')}</p>`);
  } catch (e) { setHtml('profileInfo', errLine(e)); }
}

async function loadCases() {
  try {
    const { items = [] } = await PortalAPI.getCases();
    document.getElementById('activeCasesCount').textContent =
      items.filter(c => (c.status || '').toLowerCase() !== 'closed').length;
    setHtml('casesList', items.length ? items.map(c => `
      <div class="d-flex justify-content-between align-items-center border-bottom py-2">
        <div><strong>${esc(c.title || 'Case')}</strong>
          <div class="small text-muted">${esc(c.attorney_name || 'Unassigned')}</div></div>
        <span class="badge bg-${badge(c.status)}">${esc(c.status || 'Pending')}</span>
      </div>`).join('') : empty('No cases yet.'));
  } catch (e) { setHtml('casesList', errLine(e)); }
}

async function loadDocuments() {
  try {
    const { items = [] } = await PortalAPI.getDocuments();
    document.getElementById('documentsCount').textContent = items.length;
    setHtml('documentsList', items.length ? items.map(d => `
      <div class="d-flex justify-content-between align-items-center border-bottom py-2">
        <div><i class="fas fa-file-alt text-primary me-2"></i>${esc(d.name || 'Document')}
          <div class="small text-muted">${esc(d.category || 'Other')}</div></div>
        ${d.file_url ? `<a href="${esc(d.file_url)}" target="_blank" rel="noopener" class="btn btn-outline-primary btn-sm"><i class="fas fa-download"></i></a>` : ''}
      </div>`).join('') : empty('No documents yet.'));
  } catch (e) { setHtml('documentsList', errLine(e)); }
}

async function loadMessages() {
  try {
    const { items = [] } = await PortalAPI.getMessages();
    const unread = items.filter(m => !m.read_at).length;
    document.getElementById('messagesCount').textContent = unread;
    setHtml('messagesList', items.length ? items.map(m => `
      <div class="border-bottom py-2">
        <strong>${esc(m.subject || '(no subject)')}</strong>
        <div class="small text-muted">${esc((m.message || '').slice(0, 100))}</div>
      </div>`).join('') : empty('No messages yet.'));
  } catch (e) { setHtml('messagesList', errLine(e)); }
}

async function loadInvoices() {
  try {
    const { items = [] } = await PortalAPI.getInvoices();
    const outstanding = items.filter(i => (i.status || '') !== 'paid')
      .reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    document.getElementById('outstandingBalance').textContent = `$${outstanding.toFixed(2)}`;
    setHtml('invoicesList', items.length ? items.map(i => `
      <div class="d-flex justify-content-between align-items-center border-bottom py-2">
        <div><strong>${esc(i.description || 'Invoice')}</strong>
          <div class="small text-muted">Due ${esc(i.due_date || '—')}</div></div>
        <div class="text-end">
          <span class="badge bg-${i.status === 'paid' ? 'success' : 'danger'}">${esc(i.status || 'unpaid')}</span>
          <div><strong>$${(parseFloat(i.amount) || 0).toFixed(2)}</strong></div>
        </div>
      </div>`).join('') : empty('No invoices.'));
  } catch (e) { setHtml('invoicesList', errLine(e)); }
}

async function loadAppointments() {
  try {
    const { items = [] } = await PortalAPI.getAppointments();
    const now = Date.now();
    const upcoming = items.filter(a => new Date(a.appointment_date).getTime() >= now);
    setHtml('appointmentsList', upcoming.length ? upcoming.map(a => `
      <div class="d-flex justify-content-between align-items-center border-bottom py-2">
        <div><strong>${esc(a.title || 'Appointment')}</strong>
          <div class="small text-muted">${esc(fmt(a.appointment_date))} · ${esc(a.meeting_type || 'in person')}</div></div>
        <span class="badge bg-${a.status === 'confirmed' ? 'success' : 'secondary'}">${esc(a.status || 'Pending')}</span>
      </div>`).join('') : empty('No upcoming appointments.'));
  } catch (e) { setHtml('appointmentsList', errLine(e)); }
}

async function sendMessage() {
  const subject = document.getElementById('msgSubject').value.trim();
  const message = document.getElementById('msgBody').value.trim();
  if (!subject || !message) { alert('Subject and message are required.'); return; }
  const btn = document.getElementById('sendMessageBtn');
  btn.disabled = true;
  try {
    await PortalAPI.sendMessage({ subject, message });
    bootstrap.Modal.getInstance(document.getElementById('newMessageModal')).hide();
    document.getElementById('msgSubject').value = '';
    document.getElementById('msgBody').value = '';
    await loadMessages();
  } catch (e) { alert(e.message || 'Failed to send message.'); }
  finally { btn.disabled = false; }
}

function logout() {
  ['cognito_id_token', 'user_email', 'user_role'].forEach(k => { try { sessionStorage.removeItem(k); } catch (_) {} });
  location.href = 'client-login.html';
}

// --- small DOM/format helpers ----------------------------------------------
function toggleLoading(on) {
  document.getElementById('loadingState').style.display = on ? 'block' : 'none';
  document.getElementById('dashboardContent').style.display = on ? 'none' : 'block';
}
function setHtml(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }
function showError(msg) { const b = document.getElementById('errorBanner'); if (b) { b.textContent = msg; b.style.display = 'block'; } }
function empty(msg) { return `<p class="text-muted mb-0">${esc(msg)}</p>`; }
function errLine() { return '<p class="text-danger mb-0">Could not load.</p>'; }
function badge(s) { s = (s || '').toLowerCase(); return s === 'closed' ? 'secondary' : s === 'active' || s === 'in progress' ? 'primary' : 'warning'; }
function fmt(d) { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? d : x.toLocaleString(); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
