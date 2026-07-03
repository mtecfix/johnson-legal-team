// Admin dashboard — consumes window.PortalAPI.admin.
// NOTE: authorization is enforced server-side (the API rejects non-admins with
// 403 and restricts role changes to super_admin). The client-side role gate
// below is only for UX; it is NOT a security control.
'use strict';

let currentRole = 'client';

document.addEventListener('DOMContentLoaded', () => {
  if (!window.PortalAPI) { showError('API client not loaded.'); return; }

  currentRole = localStorage.getItem('user_role') || 'client';
  document.getElementById('userGreeting').textContent = localStorage.getItem('user_email') || '';
  document.getElementById('roleBadge').textContent = currentRole;
  document.getElementById('logoutBtn').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  // UX gate only — server is the real gate.
  if (currentRole !== 'admin' && currentRole !== 'super_admin') {
    document.getElementById('accessDenied').style.display = 'block';
    return;
  }

  document.getElementById('adminContent').style.display = 'block';
  if (currentRole === 'super_admin') {
    document.querySelectorAll('.super-admin-only').forEach(el => el.style.display = '');
  }
  loadAll();
});

async function loadAll() {
  toggleLoading(true);
  const tasks = [loadClients(), loadRegistrations(), loadInvoices()];
  if (currentRole === 'super_admin') tasks.push(loadUsers());
  await Promise.allSettled(tasks);
  toggleLoading(false);
}

async function loadClients() {
  try {
    const { items = [] } = await PortalAPI.admin.listClients();
    setHtml('clientsList', items.length ? table(
      ['Name', 'Email', 'Role', 'Status'],
      items.map(c => [
        `${esc(c.first_name)} ${esc(c.last_name)}`,
        esc(c.email),
        `<span class="badge bg-secondary">${esc(c.role || 'client')}</span>`,
        esc(c.registration_status || 'active'),
      ])) : empty('No clients found.'));
  } catch (e) { setHtml('clientsList', errLine(e)); }
}

async function loadRegistrations() {
  try {
    const { registrations = [] } = await PortalAPI.admin.listRegistrations();
    const badge = document.getElementById('regBadge');
    if (registrations.length) { badge.textContent = registrations.length; badge.classList.remove('d-none'); }
    setHtml('registrationsList', registrations.length ? registrations.map(r => `
      <div class="d-flex justify-content-between align-items-center border-bottom py-2">
        <div><strong>${esc(r.first_name)} ${esc(r.last_name)}</strong>
          <span class="text-muted small">${esc(r.email)}</span></div>
        <div>
          <button class="btn btn-success btn-sm me-1" data-decide="approved" data-user="${esc(r.user_id || r.PK)}"><i class="fas fa-check"></i> Approve</button>
          <button class="btn btn-danger btn-sm" data-decide="rejected" data-user="${esc(r.user_id || r.PK)}"><i class="fas fa-times"></i> Reject</button>
        </div>
      </div>`).join('') : empty('No pending registrations.'));
    // Delegate button clicks.
    document.getElementById('registrationsList').querySelectorAll('[data-decide]').forEach(btn => {
      btn.addEventListener('click', () => decide(btn.dataset.user, btn.dataset.decide));
    });
  } catch (e) { setHtml('registrationsList', errLine(e)); }
}

async function decide(userId, decision) {
  if (decision === 'rejected' && !confirm('Reject this registration?')) return;
  try {
    await PortalAPI.admin.decideRegistration({ user_id: userId, decision });
    await Promise.allSettled([loadRegistrations(), loadClients()]);
  } catch (e) { alert(e.message || 'Action failed.'); }
}

async function loadInvoices() {
  try {
    const { items = [] } = await PortalAPI.admin.listInvoices();
    setHtml('invoicesList', items.length ? table(
      ['Client', 'Description', 'Amount', 'Status', 'Due'],
      items.map(i => [
        esc(i.client_name || i.PK || '—'),
        esc(i.description || '—'),
        `$${(parseFloat(i.amount) || 0).toFixed(2)}`,
        `<span class="badge bg-${i.status === 'paid' ? 'success' : 'danger'}">${esc(i.status || 'unpaid')}</span>`,
        esc(i.due_date || '—'),
      ])) : empty('No invoices.'));
  } catch (e) { setHtml('invoicesList', errLine(e)); }
}

async function loadUsers() {
  try {
    const { items = [] } = await PortalAPI.admin.listUsers();
    const rows = items.map(u => {
      const uid = esc(u.user_id || u.PK || '');
      const sel = ['client', 'admin', 'super_admin'].map(r =>
        `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('');
      return [
        `${esc(u.first_name)} ${esc(u.last_name)}`,
        esc(u.email),
        `<select class="form-select form-select-sm" data-user="${uid}">${sel}</select>`,
      ];
    });
    setHtml('usersList', items.length ? table(['Name', 'Email', 'Role'], rows) : empty('No users.'));
    document.getElementById('usersList').querySelectorAll('select[data-user]').forEach(sel => {
      sel.addEventListener('change', () => changeRole(sel.dataset.user, sel.value, sel));
    });
  } catch (e) { setHtml('usersList', errLine(e)); }
}

async function changeRole(userId, role, selEl) {
  const prev = selEl ? Array.from(selEl.options).find(o => o.defaultSelected)?.value : null;
  if (!confirm(`Change this user's role to "${role}"?`)) { if (selEl && prev) selEl.value = prev; return; }
  try {
    await PortalAPI.admin.changeRole({ user_id: userId, role });
  } catch (e) {
    alert(e.message || 'Failed to change role.');
    if (selEl && prev) selEl.value = prev;
  }
}

function logout() {
  ['cognito_id_token', 'cognito_access_token', 'cognito_refresh_token', 'user_email', 'user_role', 'clientLoggedIn']
    .forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
  location.href = 'client-login.html';
}

// --- helpers ---------------------------------------------------------------
function table(headers, rows) {
  return `<div class="table-responsive"><table class="table table-sm table-hover mb-0">
    <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}
function toggleLoading(on) {
  document.getElementById('loadingState').style.display = on ? 'block' : 'none';
  document.getElementById('panels').style.display = on ? 'none' : 'block';
}
function setHtml(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }
function showError(msg) { const b = document.getElementById('errorBanner'); if (b) { b.textContent = msg; b.style.display = 'block'; } }
function empty(msg) { return `<p class="text-muted mb-0">${esc(msg)}</p>`; }
function errLine() { return '<p class="text-danger mb-0">Could not load.</p>'; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
