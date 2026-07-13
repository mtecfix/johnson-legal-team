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
  super_admin: { stats: ['clients','cases','deadlines','registrations'], showJudeStatus: true },
  admin:       { stats: ['clients','cases','deadlines','registrations'], showJudeStatus: true },
  staff:       { stats: ['cases','deadlines'], showJudeStatus: false },
};

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  currentRole = sessionStorage.getItem('user_role') || 'client';
  const email = sessionStorage.getItem('user_email') || '';

  document.getElementById('userEmail').textContent = email;
  document.getElementById('roleBadge').textContent = ROLE_LABELS[currentRole] || currentRole;

  // Auth gate — must be at least staff
  if (!ROLE_HIERARCHY.includes(currentRole)) {
    document.getElementById('accessDenied').style.display = 'block';
    document.getElementById('accessDenied').innerHTML = `<i class="fas fa-lock"></i><p>Access denied. Admin privileges required.<br><a href="admin/index.html">Go to admin login</a></p>`;
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
    sessionStorage.clear();
    window.location.href = 'admin/index.html';
  });

  // Lead filters (reserved section — guard against missing elements)
  const lfStage = document.getElementById('leadFilterStage');
  const lfUrg = document.getElementById('leadFilterUrgency');
  if (lfStage) lfStage.addEventListener('change', renderLeadsTable);
  if (lfUrg) lfUrg.addEventListener('change', renderLeadsTable);

  // Contact search
  document.getElementById('contactSearch').addEventListener('input', renderContactsTable);

  // Customize dashboard for role
  applyDashboardRole(currentRole);

  // Wire up forms
  setupMessageForm();
  setupEventForm();

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
  const statMap = { clients: 0, cases: 1, deadlines: 2, registrations: 3 };
  const statCards = document.querySelectorAll('#panelDashboard .stat-card');
  Object.entries(statMap).forEach(([key, idx]) => {
    if (statCards[idx]) {
      statCards[idx].closest('.col-md-3').style.display = config.stats.includes(key) ? '' : 'none';
    }
  });

  // Jude status panel
  const judeCol = document.querySelector('#panelDashboard .col-lg-4');
  if (judeCol && !config.showJudeStatus) judeCol.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════

const sectionTitles = {
  dashboard: 'Dashboard',
  leads: 'Leads',
  cases: 'Cases',
  contacts: 'Contacts',
  calendar: 'Calendar & Deadlines',
  documents: 'Documents',
  messages: 'Messages',
  invoices: 'Invoices & Billing',
  payments: 'Payments & Billing',
  registrations: 'Registrations',
  users: 'User Roles',
  system: 'System Administration',
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
    loadClients(),
    loadCases(),
    loadRegistrations(),
    loadInvoices(),
    loadMessages(),
    loadCalendar(),
    loadUsers(),
  ]);
  updateStats();
}

// Leads reserved for now — no auto-load. New-business-only definition.
// When the inbox-monitor pipeline is deployed, re-enable loadLeads() here.

async function loadClients() {
  try {
    if (!window.PortalAPI) { console.error('PortalAPI not loaded'); return; }
    const data = await PortalAPI.admin.listClients();
    clientsData = data.items || [];
    renderContactsTable();
    populateRecipients();
  } catch (e) {
    console.error('loadClients failed:', e.message);
    document.getElementById('contactsTable').innerHTML = emptyState('fas fa-exclamation-triangle', 'Failed to load clients: ' + e.message);
  }
}

let casesData = [];
async function loadCases() {
  try {
    if (!window.PortalAPI) { console.error('PortalAPI not loaded'); return; }
    const data = await PortalAPI.admin.listCases();
    casesData = data.items || [];
    renderCasesTable();
  } catch (e) {
    console.error('loadCases failed:', e.message);
    document.getElementById('casesContent').innerHTML = emptyState('fas fa-exclamation-triangle', 'Failed to load cases: ' + e.message);
  }
}

function renderCasesTable() {
  if (!casesData.length) {
    document.getElementById('casesContent').innerHTML = emptyState('fas fa-briefcase', 'No cases yet.');
    const rc = document.getElementById('recentCases');
    if (rc) rc.innerHTML = emptyState('fas fa-briefcase', 'No cases yet.');
    return;
  }

  const caseTypeLabels = {
    'family-law': 'Family Law', 'criminal-defense': 'Criminal Defense',
    'probate-estate': 'Probate & Estate', 'personal-injury': 'Personal Injury',
    'juvenile': 'Juvenile', 'real-estate': 'Real Estate', 'traffic': 'Traffic', 'general': 'General'
  };

  const rowHtml = (c) => {
    const statusClass = c.status === 'active' ? 'qualified' : c.status === 'closed' ? 'lost' : 'new';
    const typeLabel = caseTypeLabels[c.case_type] || c.case_type || 'General';
    const date = c.opened_at ? new Date(c.opened_at).toLocaleDateString() : '';
    return `<tr>
      <td><strong>${esc(c.client_name || '—')}</strong><br><span style="color:var(--muted);font-size:11px;">${esc(c.client_email || '')}</span></td>
      <td style="font-size:12px;">${esc(typeLabel)}</td>
      <td><span class="badge-stage ${statusClass}">${esc(c.status || 'active')}</span></td>
      <td style="font-size:12px;color:var(--muted);">${date}</td>
    </tr>`;
  };

  const header = `<table class="data-table"><thead><tr><th>Client</th><th>Case Type</th><th>Status</th><th>Opened</th></tr></thead><tbody>`;

  // Full cases table
  document.getElementById('casesContent').innerHTML = header + casesData.map(rowHtml).join('') + '</tbody></table>';
  const cc = document.getElementById('casesCount');
  if (cc) cc.textContent = `${casesData.length} total`;

  // Recent cases (dashboard home) — last 6
  const rc = document.getElementById('recentCases');
  if (rc) {
    const recent = casesData.slice().sort((a,b) => (b.opened_at||'').localeCompare(a.opened_at||'')).slice(0, 6);
    rc.innerHTML = header + recent.map(rowHtml).join('') + '</tbody></table>';
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
  document.getElementById('statCases').textContent = casesData.filter(c => c.status === 'active').length || '0';
  const dl = document.getElementById('statDeadlines');
  if (dl) {
    const now = new Date();
    const soon = new Date(now.getTime() + 30 * 864e5); // next 30 days
    const upcoming = calendarData.filter(e => {
      const d = e.event_date ? new Date(e.event_date) : null;
      return d && d >= now && d <= soon;
    }).length;
    dl.textContent = upcoming;
  }
  const pendingRegs = document.querySelectorAll('#registrationsContent .btn-success').length;
  document.getElementById('statRegistrations').textContent = pendingRegs || '0';

  // System panel counts (super_admin)
  const sysLeads = document.getElementById('sysLeadsCount');
  if (sysLeads) sysLeads.textContent = '0 (reserved)';
  const sysPortal = document.getElementById('sysPortalCount');
  if (sysPortal) sysPortal.textContent = clientsData.length;
}

// ═══════════════════════════════════════════════════════════════
// LEADS RENDERING
// ═══════════════════════════════════════════════════════════════

function renderLeadsTable() {
  const table = document.getElementById('leadsTable');
  if (!table || table.style.display === 'none') return; // Leads reserved — no render
  const stageEl = document.getElementById('leadFilterStage');
  const urgEl = document.getElementById('leadFilterUrgency');
  const stageFilter = stageEl ? stageEl.value : '';
  const urgencyFilter = urgEl ? urgEl.value : '';

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

function renderRecentLeads() { /* reserved — leads disabled */ }

function toggleLeadDetail(leadId) {
  const row = document.getElementById(`lead-detail-${leadId}`);
  row.style.display = row.style.display === 'none' ? '' : 'none';
}

async function updateLeadStage(leadId, stage) {
  try {
    const token = sessionStorage.getItem('cognito_access_token');
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
// MESSAGES (email + SMS)
// ═══════════════════════════════════════════════════════════════

async function loadMessages() {
  // Populate recipient dropdown from clients (once clients are loaded)
  populateRecipients();
  try {
    if (!window.PortalAPI) return;
    const data = await PortalAPI.admin.listMessages();
    renderMessagesLog(data.items || []);
  } catch (e) {
    const el = document.getElementById('messagesLog');
    if (el) el.innerHTML = emptyState('fas fa-exclamation-triangle', 'Failed to load messages: ' + e.message);
  }
}

function populateRecipients() {
  const sel = document.getElementById('msgRecipient');
  if (!sel) return;
  if (!clientsData.length) { sel.innerHTML = '<option value="">No clients loaded</option>'; return; }
  sel.innerHTML = clientsData.map(c => {
    const uid = (c.PK || '').replace('USER#', '');
    const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || uid;
    return `<option value="${esc(uid)}" data-email="${esc(c.email||'')}" data-phone="${esc(c.phone||c.phone_number||'')}">${esc(name)}</option>`;
  }).join('');
}

function renderMessagesLog(items) {
  const el = document.getElementById('messagesLog');
  if (!el) return;
  if (!items.length) { el.innerHTML = emptyState('fas fa-envelope', 'No messages sent yet.'); return; }
  let html = '<table class="data-table"><thead><tr><th>To</th><th>Channel</th><th>Subject / Body</th><th>Status</th><th>Date</th></tr></thead><tbody>';
  items.forEach(m => {
    const icon = m.channel === 'sms' ? 'fa-comment-sms' : 'fa-envelope';
    const statusClass = m.status === 'sent' ? 'converted' : 'lost';
    const preview = m.subject ? `<strong>${esc(m.subject)}</strong><br>` : '';
    const body = esc((m.body || '').slice(0, 80)) + ((m.body||'').length > 80 ? '…' : '');
    const date = m.created_at ? new Date(m.created_at).toLocaleString() : '';
    html += `<tr>
      <td><strong>${esc(m.to_name || '')}</strong><br><span style="color:var(--muted);font-size:11px;">${esc(m.to_address || '')}</span></td>
      <td><i class="fas ${icon}"></i> ${esc(m.channel)}</td>
      <td style="font-size:12px;">${preview}${body}</td>
      <td><span class="badge-stage ${statusClass}">${esc(m.status || '')}</span></td>
      <td style="font-size:11px;color:var(--muted);">${date}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function setupMessageForm() {
  const form = document.getElementById('messageForm');
  if (!form) return;

  // Toggle subject field + SMS hint based on channel
  document.querySelectorAll('input[name="channel"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isSms = document.getElementById('channelSms').checked;
      document.getElementById('subjectWrap').style.display = isSms ? 'none' : '';
      document.getElementById('smsHint').hidden = !isSms;
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('msgSendBtn');
    const result = document.getElementById('msgResult');
    const channel = document.querySelector('input[name="channel"]:checked').value;
    const to_user_id = document.getElementById('msgRecipient').value;
    const subject = document.getElementById('msgSubject').value.trim();
    const body = document.getElementById('msgBody').value.trim();

    if (!to_user_id || !body) { result.innerHTML = '<span style="color:var(--danger);">Recipient and message required.</span>'; return; }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    result.innerHTML = '';
    try {
      await PortalAPI.admin.sendMessage({ to_user_id, channel, subject, body });
      result.innerHTML = '<span style="color:var(--success);"><i class="fas fa-check"></i> Message sent.</span>';
      document.getElementById('msgBody').value = '';
      document.getElementById('msgSubject').value = '';
      loadMessages();
    } catch (err) {
      result.innerHTML = `<span style="color:var(--danger);"><i class="fas fa-exclamation-circle"></i> ${esc(err.message || 'Failed to send')}</span>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send';
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// CALENDAR
// ═══════════════════════════════════════════════════════════════

let calendarData = [];
async function loadCalendar() {
  try {
    if (!window.PortalAPI) return;
    const data = await PortalAPI.admin.listAppointments();
    calendarData = data.items || [];
    renderCalendar();
  } catch (e) {
    const el = document.getElementById('calendarList');
    if (el) el.innerHTML = emptyState('fas fa-exclamation-triangle', 'Failed to load calendar: ' + e.message);
  }
}

function renderCalendar() {
  const el = document.getElementById('calendarList');
  if (!el) return;
  if (!calendarData.length) { el.innerHTML = emptyState('fas fa-calendar-alt', 'No events scheduled.'); return; }

  const typeIcons = { court: 'fa-gavel', deadline: 'fa-hourglass-half', meeting: 'fa-handshake', filing: 'fa-file-signature' };
  const now = new Date();
  let html = '<table class="data-table"><thead><tr><th>Date</th><th>Event</th><th>Type</th><th>Location</th></tr></thead><tbody>';
  calendarData.forEach(evt => {
    const d = evt.event_date ? new Date(evt.event_date) : null;
    const isPast = d && d < now;
    const dateStr = d ? d.toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '';
    const icon = typeIcons[evt.event_type] || 'fa-calendar';
    html += `<tr style="${isPast ? 'opacity:.5;' : ''}">
      <td style="font-size:12px;font-weight:600;">${dateStr}</td>
      <td><strong>${esc(evt.title || '')}</strong>${evt.notes ? `<br><span style="color:var(--muted);font-size:11px;">${esc(evt.notes)}</span>` : ''}</td>
      <td style="font-size:12px;text-transform:capitalize;"><i class="fas ${icon}" style="color:var(--gold);"></i> ${esc(evt.event_type || '')}</td>
      <td style="font-size:12px;color:var(--muted);">${esc(evt.location || '—')}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function setupEventForm() {
  const form = document.getElementById('eventForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const result = document.getElementById('evtResult');
    const payload = {
      title: document.getElementById('evtTitle').value.trim(),
      event_date: document.getElementById('evtDate').value,
      event_type: document.getElementById('evtType').value,
      location: document.getElementById('evtLocation').value.trim(),
      notes: document.getElementById('evtNotes').value.trim(),
    };
    if (!payload.title || !payload.event_date) { result.innerHTML = '<span style="color:var(--danger);">Title and date required.</span>'; return; }
    try {
      await PortalAPI.admin.createAppointment(payload);
      result.innerHTML = '<span style="color:var(--success);"><i class="fas fa-check"></i> Event added.</span>';
      form.reset();
      loadCalendar();
      updateStats();
    } catch (err) {
      result.innerHTML = `<span style="color:var(--danger);">${esc(err.message || 'Failed')}</span>`;
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// USER ROLES (super_admin only)
// ═══════════════════════════════════════════════════════════════

async function loadUsers() {
  const el = document.getElementById('usersContent');
  if (!el) return; // panel removed for non-super_admin
  try {
    if (!window.PortalAPI) return;
    const data = await PortalAPI.admin.listUsers();
    renderUsers(data.items || []);
  } catch (e) {
    el.innerHTML = emptyState('fas fa-exclamation-triangle', 'Failed to load users: ' + e.message);
  }
}

function renderUsers(users) {
  const el = document.getElementById('usersContent');
  if (!el) return;
  const staff = users.filter(u => u.role === 'admin' || u.role === 'super_admin' || u.role === 'staff');
  if (!staff.length) { el.innerHTML = emptyState('fas fa-shield-alt', 'No staff accounts.'); return; }
  let html = `<div class="alert alert-info py-2" style="font-size:12px;margin:16px;">Role changes take effect on the user's next login. Only super_admin can modify roles.</div>`;
  html += '<table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Current Role</th><th>Change To</th></tr></thead><tbody>';
  staff.forEach(u => {
    const uid = (u.PK || '').replace('USER#', '');
    html += `<tr>
      <td><strong>${esc(u.first_name || '')} ${esc(u.last_name || '')}</strong></td>
      <td>${esc(u.email || '')}</td>
      <td><span class="badge bg-dark">${esc(u.role || 'client')}</span></td>
      <td>
        <select class="form-select form-select-sm" style="width:auto;display:inline-block;font-size:12px;" onchange="changeUserRole('${esc(uid)}', this.value)">
          <option value="">—</option>
          <option value="staff">staff</option>
          <option value="admin">admin</option>
          <option value="super_admin">super_admin</option>
        </select>
      </td>
    </tr>`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

async function changeUserRole(userId, role) {
  if (!role) return;
  if (!confirm(`Change this user's role to "${role}"?`)) return;
  try {
    await PortalAPI.admin.changeRole({ user_id: userId, role });
    alert('Role updated. Takes effect on next login.');
    loadUsers();
  } catch (e) { alert(e.message || 'Failed to change role.'); }
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
window.changeUserRole = changeUserRole;
