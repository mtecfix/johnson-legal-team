// Johnson Legal Team — Practice Manager Dashboard
// Integrates with Portal API (Cognito-authed) + Jude Leads API
'use strict';

const JUDE_API = 'https://mpiai89295.execute-api.us-east-1.amazonaws.com';
let currentRole = 'client';
let leadsData = [];
let clientsData = [];

// ═══════════════════════════════════════════════════════════════
// ROLE DEFINITIONS
// ═══════════════════════════════════════════════════════════════
// super_admin (MR TECH): Full system access — all modules + system config + user roles + Jude AI
// admin (Attorney Johnson): Practice management — dashboard, leads, cases, contacts, calendar, docs, messages, invoices, payments, registrations
// staff (paralegals/assistants): Limited — dashboard (read-only), cases (assigned), contacts, calendar, docs, messages

const ROLE_HIERARCHY = ['staff', 'admin', 'super_admin'];
const ROLE_LABELS = {
  super_admin: 'System Administrator',
  admin: 'Attorney',
  staff: 'Staff',
};

// What each role's dashboard home shows
const ROLE_DASHBOARD = {
  super_admin: { stats: ['clients','leads','cases','registrations'], showJudeStatus: true, showRecentLeads: true, showSystemHealth: true },
  admin:       { stats: ['clients','leads','cases','registrations'], showJudeStatus: true, showRecentLeads: true, showSystemHealth: false },
  staff:       { stats: ['cases'], showJudeStatus: false, showRecentLeads: false, showSystemHealth: false },
};

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  currentRole = localStorage.getItem('user_role') || 'client';
  const email = localStorage.getItem('user_email') || '';

  document.getElementById('userEmail').textContent = email;
  document.getElementById('roleBadge').textContent = ROLE_LABELS[currentRole] || currentRole;

  // Auth gate — must be at least staff
  if (!ROLE_HIERARCHY.includes(currentRole)) {
    document.getElementById('accessDenied').style.display = 'block';
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    return;
  }

  // Apply role-based visibility to sidebar and panels
  applyRoleVisibility(currentRole);

  // Navigation
  document.querySelectorAll('[data-section]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(link.dataset.section);
    });
  });

  // Sidebar toggle (mobile)
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', e => {
    e.preventDefault();
    localStorage.clear();
    window.location.href = 'admin/index.html';
  });

  // Lead filters
  document.getElementById('leadFilterStage').addEventListener('change', renderLeadsTable);
  document.getElementById('leadFilterUrgency').addEventListener('change', renderLeadsTable);

  // Contact search
  document.getElementById('contactSearch').addEventListener('input', renderContactsTable);

  // Customize dashboard for role
  applyDashboardRole(currentRole);

  // Load data
  loadAll();
});

// ═══════════════════════════════════════════════════════════════
// ROLE VISIBILITY
// ═══════════════════════════════════════════════════════════════

function applyRoleVisibility(role) {
  // Sidebar links: show/hide based on data-roles
  document.querySelectorAll('.sidebar-nav [data-roles]').forEach(el => {
    const allowed = el.dataset.roles.split(',');
    el.style.display = allowed.includes(role) ? '' : 'none';
  });

  // Panels: show/hide based on data-roles (keep display logic for active panel)
  document.querySelectorAll('.panel[data-roles]').forEach(el => {
    const allowed = el.dataset.roles.split(',');
    if (!allowed.includes(role)) {
      el.remove(); // Remove entirely so it can't be navigated to
    }
  });
}

function applyDashboardRole(role) {
  const config = ROLE_DASHBOARD[role] || ROLE_DASHBOARD.staff;

  // Hide stat cards not in role config
  const statMap = { clients: 0, leads: 1, cases: 2, registrations: 3 };
  const statCards = document.querySelectorAll('#panelDashboard .stat-card');
  Object.entries(statMap).forEach(([key, idx]) => {
    if (statCards[idx]) {
      statCards[idx].closest('.col-md-3').style.display = config.stats.includes(key) ? '' : 'none';
    }
  });

  // Jude status panel
  const judeCol = document.querySelector('#panelDashboard .col-lg-4');
  if (judeCol && !config.showJudeStatus) judeCol.style.display = 'none';

  // Recent leads
  const recentLeadsCard = document.querySelector('#panelDashboard .col-lg-8');
  if (recentLeadsCard && !config.showRecentLeads) {
    recentLeadsCard.classList.replace('col-lg-8', 'col-lg-12');
    recentLeadsCard.innerHTML = `<div class="panel-card"><div class="panel-card-header"><h2>My Assigned Cases</h2></div><div class="panel-card-body padded"><div class="empty-state"><i class="fas fa-briefcase"></i><p>Your assigned cases will appear here.</p></div></div></div>`;
  }
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════

const sectionTitles = {
  dashboard: 'Dashboard',
  leads: 'Lead Pipeline',
  cases: 'Cases',
  contacts: 'Contacts',
  calendar: 'Calendar & Deadlines',
  documents: 'Documents',
  messages: 'Messages',
  invoices: 'Invoices & Billing',
  registrations: 'Registrations',
  users: 'User Roles',
};

function navigateTo(section) {
  // Update sidebar active
  document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));
  const activeLink = document.querySelector(`[data-section="${section}"]`);
  if (activeLink) activeLink.classList.add('active');

  // Show panel
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('panel' + capitalize(section));
  if (panel) panel.classList.add('active');

  // Update title
  document.getElementById('pageTitle').textContent = sectionTitles[section] || section;

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ═══════════════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════════════

async function loadAll() {
  await Promise.allSettled([
    loadLeads(),
    loadClients(),
    loadRegistrations(),
    loadInvoices(),
  ]);
  updateStats();
}

async function loadLeads() {
  try {
    const token = localStorage.getItem('cognito_id_token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const res = await fetch(`${JUDE_API}/leads`, { headers });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    leadsData = (data.leads || []).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    document.getElementById('leadsCount').textContent = leadsData.filter(l => l.stage === 'new').length || '';
    renderLeadsTable();
    renderRecentLeads();
  } catch (e) {
    document.getElementById('leadsTable').innerHTML = emptyState('fas fa-exclamation-triangle', 'Failed to load leads.');
  }
}

async function loadClients() {
  try {
    if (!window.PortalAPI) return;
    const { items = [] } = await PortalAPI.admin.listClients();
    clientsData = items;
    renderContactsTable();
  } catch (e) {
    document.getElementById('contactsTable').innerHTML = emptyState('fas fa-exclamation-triangle', 'Failed to load clients.');
  }
}

async function loadRegistrations() {
  try {
    if (!window.PortalAPI) return;
    const { registrations = [] } = await PortalAPI.admin.listRegistrations();
    renderRegistrations(registrations);
  } catch (e) {
    document.getElementById('registrationsContent').innerHTML = emptyState('fas fa-exclamation-triangle', 'Failed to load.');
  }
}

async function loadInvoices() {
  try {
    if (!window.PortalAPI) return;
    const { invoices = [] } = await PortalAPI.admin.listInvoices();
    renderInvoices(invoices);
  } catch (e) {
    document.getElementById('invoicesTable').innerHTML = emptyState('fas fa-file-invoice-dollar', 'No invoices yet.');
  }
}

function updateStats() {
  document.getElementById('statClients').textContent = clientsData.length;
  document.getElementById('statLeads').textContent = leadsData.filter(l => l.stage === 'new' || l.stage === 'contacted').length;
  document.getElementById('statCases').textContent = '—';
  const pendingRegs = document.querySelectorAll('#registrationsContent .btn-success').length;
  document.getElementById('statRegistrations').textContent = pendingRegs || '0';

  // System panel counts (super_admin)
  const sysLeads = document.getElementById('sysLeadsCount');
  if (sysLeads) sysLeads.textContent = leadsData.length;
  const sysPortal = document.getElementById('sysPortalCount');
  if (sysPortal) sysPortal.textContent = clientsData.length;
}

// ═══════════════════════════════════════════════════════════════
// LEADS RENDERING
// ═══════════════════════════════════════════════════════════════

function renderLeadsTable() {
  const stageFilter = document.getElementById('leadFilterStage').value;
  const urgencyFilter = document.getElementById('leadFilterUrgency').value;

  let filtered = leadsData;
  if (stageFilter) filtered = filtered.filter(l => l.stage === stageFilter);
  if (urgencyFilter) filtered = filtered.filter(l => l.urgency === urgencyFilter);

  if (!filtered.length) {
    document.getElementById('leadsTable').innerHTML = emptyState('fas fa-bolt', 'No leads match filters.');
    return;
  }

  let html = `<table class="data-table">
    <thead><tr>
      <th>Score</th><th>Name / Email</th><th>Practice Area</th><th>Location</th><th>Source</th><th>Urgency</th><th>Stage</th><th>Date</th><th></th>
    </tr></thead><tbody>`;

  filtered.forEach(lead => {
    const scoreClass = lead.score >= 70 ? 'high' : lead.score >= 40 ? 'medium' : 'low';
    const caseType = (lead.caseType || 'general').replace(/-/g, ' ');
    const date = lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : '';
    html += `<tr id="lead-row-${lead.leadId}">
      <td><span class="badge-score ${scoreClass}">${lead.score || 0}</span></td>
      <td><strong>${esc(lead.name || '')}</strong><br><span style="color:var(--muted);font-size:11px;">${esc(lead.email || '')}</span></td>
      <td style="text-transform:capitalize;">${esc(caseType)}</td>
      <td>${esc(lead.location || '—')}</td>
      <td><span style="font-size:11px;${lead.source === 'lawyer.com' ? 'color:var(--muted);' : ''}">${esc(lead.source || '')}</span></td>
      <td><span class="badge-score ${lead.urgency || 'low'}">${(lead.urgency || 'low').toUpperCase()}</span></td>
      <td><span class="badge-stage ${lead.stage || 'new'}">${lead.stage || 'new'}</span></td>
      <td style="font-size:11px;color:var(--muted);">${date}</td>
      <td><button class="btn btn-sm btn-outline-secondary" onclick="toggleLeadDetail('${lead.leadId}')"><i class="fas fa-chevron-down"></i></button></td>
    </tr>
    <tr id="lead-detail-${lead.leadId}" style="display:none;">
      <td colspan="9">
        <div class="lead-detail">
          <div class="row">
            <div class="col-md-8">
              <strong>Subject:</strong> ${esc(lead.subject || '(none)')}<br>
              <strong>Phone:</strong> ${esc(lead.phone || '—')}
              <div class="lead-message">${esc(lead.firstMessage || '(no message)').replace(/\n/g, '<br>')}</div>
            </div>
            <div class="col-md-4">
              <strong style="font-size:12px;">Update Stage:</strong>
              <div class="d-flex flex-wrap gap-1 mt-2">
                ${['new','contacted','qualified','converted','lost'].map(s =>
                  `<button class="btn btn-sm ${lead.stage === s ? 'btn-primary' : 'btn-outline-secondary'}" onclick="updateLeadStage('${lead.leadId}','${s}')" ${lead.stage === s ? 'disabled' : ''}>${s}</button>`
                ).join('')}
              </div>
            </div>
          </div>
        </div>
      </td>
    </tr>`;
  });

  html += '</tbody></table>';
  document.getElementById('leadsTable').innerHTML = html;
}

function renderRecentLeads() {
  const recent = leadsData.slice(0, 5);
  if (!recent.length) {
    document.getElementById('recentLeads').innerHTML = emptyState('fas fa-bolt', 'No leads yet.');
    return;
  }
  let html = '<table class="data-table"><thead><tr><th>Score</th><th>Lead</th><th>Type</th><th>Urgency</th><th>Date</th></tr></thead><tbody>';
  recent.forEach(lead => {
    const scoreClass = lead.score >= 70 ? 'high' : lead.score >= 40 ? 'medium' : 'low';
    const date = lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : '';
    html += `<tr>
      <td><span class="badge-score ${scoreClass}">${lead.score || 0}</span></td>
      <td><strong>${esc(lead.name || lead.email || '?')}</strong></td>
      <td style="text-transform:capitalize;font-size:12px;">${(lead.caseType || '').replace(/-/g, ' ')}</td>
      <td><span class="badge-score ${lead.urgency || 'low'}">${(lead.urgency || 'low').toUpperCase()}</span></td>
      <td style="font-size:11px;color:var(--muted);">${date}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  document.getElementById('recentLeads').innerHTML = html;
}

function toggleLeadDetail(leadId) {
  const row = document.getElementById(`lead-detail-${leadId}`);
  row.style.display = row.style.display === 'none' ? '' : 'none';
}

async function updateLeadStage(leadId, stage) {
  try {
    const token = localStorage.getItem('cognito_access_token');
    await fetch(`${JUDE_API}/leads/${leadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ stage }),
    });
    // Update local data
    const lead = leadsData.find(l => l.leadId === leadId);
    if (lead) lead.stage = stage;
    renderLeadsTable();
    updateStats();
  } catch (e) {
    alert('Failed to update stage: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// CONTACTS RENDERING
// ═══════════════════════════════════════════════════════════════

function renderContactsTable() {
  const search = (document.getElementById('contactSearch').value || '').toLowerCase();
  let filtered = clientsData;
  if (search) {
    filtered = filtered.filter(c =>
      (c.first_name || '').toLowerCase().includes(search) ||
      (c.last_name || '').toLowerCase().includes(search) ||
      (c.email || '').toLowerCase().includes(search)
    );
  }

  if (!filtered.length) {
    document.getElementById('contactsTable').innerHTML = emptyState('fas fa-users', clientsData.length ? 'No matches.' : 'No clients registered yet.');
    return;
  }

  let html = `<table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead><tbody>`;
  filtered.forEach(c => {
    html += `<tr>
      <td><strong>${esc(c.first_name || '')} ${esc(c.last_name || '')}</strong></td>
      <td>${esc(c.email || '')}</td>
      <td><span class="badge bg-secondary" style="font-size:10px;">${esc(c.role || 'client')}</span></td>
      <td style="font-size:12px;">${esc(c.registration_status || 'active')}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  document.getElementById('contactsTable').innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════
// REGISTRATIONS
// ═══════════════════════════════════════════════════════════════

function renderRegistrations(registrations) {
  if (!registrations.length) {
    document.getElementById('registrationsContent').innerHTML = emptyState('fas fa-user-plus', 'No pending registrations.');
    return;
  }
  let html = `<table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Date</th><th>Actions</th></tr></thead><tbody>`;
  registrations.forEach(r => {
    html += `<tr>
      <td><strong>${esc(r.first_name || '')} ${esc(r.last_name || '')}</strong></td>
      <td>${esc(r.email || '')}</td>
      <td style="font-size:12px;">${r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ''}</td>
      <td>
        <button class="btn btn-success btn-sm" onclick="decideRegistration('${esc(r.user_id || r.PK)}','approved')"><i class="fas fa-check"></i></button>
        <button class="btn btn-danger btn-sm" onclick="decideRegistration('${esc(r.user_id || r.PK)}','rejected')"><i class="fas fa-times"></i></button>
      </td>
    </tr>`;
  });
  html += '</tbody></table>';
  document.getElementById('registrationsContent').innerHTML = html;
}

async function decideRegistration(userId, decision) {
  if (decision === 'rejected' && !confirm('Reject this registration?')) return;
  try {
    await PortalAPI.admin.decideRegistration({ user_id: userId, decision });
    await loadRegistrations();
    await loadClients();
    updateStats();
  } catch (e) { alert(e.message || 'Action failed.'); }
}

// ═══════════════════════════════════════════════════════════════
// INVOICES
// ═══════════════════════════════════════════════════════════════

function renderInvoices(invoices) {
  if (!invoices || !invoices.length) {
    document.getElementById('invoicesTable').innerHTML = emptyState('fas fa-file-invoice-dollar', 'No invoices yet.');
    return;
  }
  let html = `<table class="data-table"><thead><tr><th>Client</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>`;
  invoices.forEach(inv => {
    html += `<tr>
      <td>${esc(inv.client_name || inv.email || '')}</td>
      <td><strong>$${(inv.amount || 0).toFixed(2)}</strong></td>
      <td><span class="badge-stage ${inv.status === 'paid' ? 'converted' : 'new'}">${esc(inv.status || 'pending')}</span></td>
      <td style="font-size:12px;">${inv.createdAt ? new Date(inv.createdAt).toLocaleDateString() : ''}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  document.getElementById('invoicesTable').innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function emptyState(icon, msg) { return `<div class="empty-state"><i class="${icon}"></i><p>${msg}</p></div>`; }

// Make functions global for onclick handlers
window.toggleLeadDetail = toggleLeadDetail;
window.updateLeadStage = updateLeadStage;
window.decideRegistration = decideRegistration;
window.navigateTo = navigateTo;
