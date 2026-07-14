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

  // Contact search + filters
  document.getElementById('contactSearch').addEventListener('input', renderContactsTable);
  const ctf = document.getElementById('contactTypeFilter');
  const ccf = document.getElementById('contactCategoryFilter');
  if (ctf) ctf.addEventListener('change', renderContactsTable);
  if (ccf) ccf.addEventListener('change', renderContactsTable);

  // Case filters
  const cftEl = document.getElementById('caseFilterType');
  const cfsEl = document.getElementById('caseFilterStatus');
  if (cftEl) cftEl.addEventListener('change', renderCasesTable);
  if (cfsEl) cfsEl.addEventListener('change', renderCasesTable);

  // Case type tabs
  document.querySelectorAll('.case-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.case-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderCasesTable();
    });
  });

  // Case detail back button
  const caseBackBtn = document.getElementById('caseBackBtn');
  if (caseBackBtn) caseBackBtn.addEventListener('click', closeCaseDetail);

  // Customize dashboard for role
  applyDashboardRole(currentRole);

  // Wire up forms
  setupMessageForm();
  setupEventForm();
  setupCaseCrud();
  setupInvoiceCrud();

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

const caseTypeLabels = {
  'family-law': 'Family Law', 'criminal-defense': 'Criminal Defense',
  'probate-estate': 'Probate & Estate', 'personal-injury': 'Personal Injury',
  'juvenile': 'Juvenile', 'real-estate': 'Real Estate', 'traffic': 'Traffic', 'general': 'General'
};

const caseTypeIcons = {
  'family-law': 'fas fa-home', 'criminal-defense': 'fas fa-gavel',
  'probate-estate': 'fas fa-landmark', 'personal-injury': 'fas fa-user-injured',
  'juvenile': 'fas fa-child', 'real-estate': 'fas fa-building', 'traffic': 'fas fa-car', 'general': 'fas fa-briefcase'
};

function renderCasesTable() {
  if (!casesData.length) {
    document.getElementById('casesContent').innerHTML = emptyState('fas fa-briefcase', 'No cases yet.');
    const rc = document.getElementById('recentCases');
    if (rc) rc.innerHTML = emptyState('fas fa-briefcase', 'No cases yet.');
    updateCaseTabCounts();
    return;
  }

  // Get active tab type
  const activeTab = document.querySelector('.case-tab.active');
  const filterType = activeTab ? activeTab.dataset.type : '';

  // Filter by type
  let filtered = casesData;
  if (filterType) filtered = filtered.filter(c => c.case_type === filterType);

  // Sort by opened_at descending (newest first)
  filtered.sort((a, b) => (b.opened_at || '').localeCompare(a.opened_at || ''));

  // Update heading
  const heading = document.getElementById('casesHeading');
  if (heading) {
    heading.textContent = filterType ? (caseTypeLabels[filterType] || 'Cases') : 'All Cases';
  }

  // Update tab counts
  updateCaseTabCounts();

  const rowHtml = (c, idx) => {
    const statusClass = c.status === 'active' ? 'qualified' : c.status === 'closed' ? 'lost' : 'new';
    const typeLabel = caseTypeLabels[c.case_type] || c.case_type || 'General';
    const date = c.opened_at ? new Date(c.opened_at).toLocaleDateString() : '';
    const caseId = c.case_id || (c.SK ? c.SK.replace('CASE#', '') : '') || idx.toString();
    return `<tr style="cursor:pointer;" onclick="openCaseDetail('${esc(caseId)}')">
      <td><strong>${esc(c.client_name || '—')}</strong><br><span style="color:var(--muted);font-size:11px;">${esc(c.client_email || '')}</span></td>
      <td style="font-size:12px;"><i class="${caseTypeIcons[c.case_type] || 'fas fa-briefcase'}" style="margin-right:4px;color:var(--navy);"></i>${esc(typeLabel)}</td>
      <td><span class="badge-stage ${statusClass}">${esc(c.status || 'active')}</span></td>
      <td style="font-size:12px;color:var(--muted);">${date}</td>
      <td style="font-size:12px;color:var(--gold);"><i class="fas fa-chevron-right"></i></td>
    </tr>`;
  };

  const header = `<table class="data-table"><thead><tr><th>Client</th><th>Case Type</th><th>Status</th><th>Opened</th><th></th></tr></thead><tbody>`;

  // Full cases table (filtered)
  if (!filtered.length) {
    document.getElementById('casesContent').innerHTML = emptyState('fas fa-filter', 'No cases match filters.');
  } else {
    document.getElementById('casesContent').innerHTML = header + filtered.map(rowHtml).join('') + '</tbody></table>';
  }
  const cc = document.getElementById('casesCount');
  if (cc) cc.textContent = `${filtered.length} of ${casesData.length} cases`;

  // Recent cases (dashboard home) — last 6
  const rc = document.getElementById('recentCases');
  if (rc) {
    const recent = casesData.slice().sort((a,b) => (b.opened_at||'').localeCompare(a.opened_at||'')).slice(0, 6);
    const recentHeader = `<table class="data-table"><thead><tr><th>Client</th><th>Case Type</th><th>Status</th><th>Opened</th><th></th></tr></thead><tbody>`;
    rc.innerHTML = recentHeader + recent.map(rowHtml).join('') + '</tbody></table>';
  }
}

// ═══════════════════════════════════════════════════════════════
// CASE DETAIL VIEW
// ═══════════════════════════════════════════════════════════════

function openCaseDetail(caseId) {
  const caseItem = casesData.find(c => {
    const id = c.case_id || (c.SK ? c.SK.replace('CASE#', '') : '');
    return id === caseId;
  });
  if (!caseItem) return;

  currentCaseId = caseId;
  currentCaseUserId = (caseItem.PK || '').replace('USER#', '');

  // Switch view
  document.getElementById('casesListView').style.display = 'none';
  document.getElementById('caseDetailView').style.display = 'block';

  // Populate header
  const clientName = caseItem.client_name || 'Unknown Client';
  const typeLabel = caseTypeLabels[caseItem.case_type] || caseItem.case_type || 'General';
  const statusClass = caseItem.status === 'active' ? 'qualified' : caseItem.status === 'closed' ? 'lost' : 'new';

  document.getElementById('caseDetailTitle').textContent = clientName;
  document.getElementById('caseDetailSubtitle').textContent = `Case ID: ${caseId.substring(0, 8)}  •  ${caseItem.folder || ''}`;
  document.getElementById('caseDetailStatus').textContent = caseItem.status || 'active';
  document.getElementById('caseDetailStatus').className = `badge-stage ${statusClass}`;
  document.getElementById('caseDetailType').innerHTML = `<i class="${caseTypeIcons[caseItem.case_type] || 'fas fa-briefcase'}" style="margin-right:4px;"></i>${typeLabel}`;

  // Case Overview
  const overviewHtml = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div>
        <p style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:0 0 4px;">Case Type</p>
        <p style="font-size:14px;font-weight:500;margin:0;"><i class="${caseTypeIcons[caseItem.case_type] || 'fas fa-briefcase'}" style="margin-right:6px;color:var(--navy);"></i>${esc(typeLabel)}</p>
      </div>
      <div>
        <p style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:0 0 4px;">Status</p>
        <p style="font-size:14px;font-weight:500;margin:0;"><span class="badge-stage ${statusClass}">${esc(caseItem.status || 'active')}</span></p>
      </div>
      <div>
        <p style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:0 0 4px;">Case File / Folder</p>
        <p style="font-size:13px;margin:0;"><i class="fas fa-folder" style="color:var(--gold);margin-right:6px;"></i>${esc(caseItem.folder || 'No folder assigned')}</p>
      </div>
      <div>
        <p style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:0 0 4px;">Case ID</p>
        <p style="font-size:13px;margin:0;font-family:monospace;">${esc(caseId)}</p>
      </div>
    </div>
  `;
  document.getElementById('caseDetailOverview').innerHTML = overviewHtml;

  // Notes
  const notes = caseItem.notes || '';
  const notesHtml = notes
    ? `<div style="font-size:13px;line-height:1.7;white-space:pre-wrap;background:var(--bg);padding:12px;border-radius:6px;">${esc(notes)}</div>`
    : `<div style="font-size:13px;color:var(--muted);text-align:center;padding:24px;">No notes yet. Click "Add Note" to document case activity.</div>`;
  document.getElementById('caseDetailNotes').innerHTML = notesHtml;

  // Client info
  const clientHtml = `
    <div style="font-size:13px;line-height:2.2;">
      <div><i class="fas fa-user" style="width:20px;color:var(--navy);"></i> <strong>${esc(clientName)}</strong></div>
      <div><i class="fas fa-envelope" style="width:20px;color:var(--muted);"></i> ${esc(caseItem.client_email || 'No email on file')}</div>
      <div><i class="fas fa-phone" style="width:20px;color:var(--muted);"></i> ${esc(caseItem.client_phone || 'No phone on file')}</div>
      <div><i class="fas fa-id-badge" style="width:20px;color:var(--muted);"></i> <span style="font-family:monospace;font-size:11px;">${esc(caseItem.user_id || caseItem.PK || '')}</span></div>
    </div>
  `;
  document.getElementById('caseDetailClient').innerHTML = clientHtml;

  // Key dates
  const openedDate = caseItem.opened_at ? new Date(caseItem.opened_at).toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }) : 'Unknown';
  const daysSinceOpen = caseItem.opened_at ? Math.floor((Date.now() - new Date(caseItem.opened_at).getTime()) / 864e5) : '—';
  const datesHtml = `
    <div style="font-size:13px;line-height:2.4;">
      <div style="display:flex;justify-content:space-between;"><span><i class="fas fa-calendar-plus" style="width:20px;color:var(--success);"></i> Opened</span><strong>${openedDate}</strong></div>
      <div style="display:flex;justify-content:space-between;"><span><i class="fas fa-clock" style="width:20px;color:var(--warning);"></i> Days Open</span><strong>${daysSinceOpen}</strong></div>
      <div style="display:flex;justify-content:space-between;"><span><i class="fas fa-calendar-check" style="width:20px;color:var(--muted);"></i> Closed</span><span style="color:var(--muted);">—</span></div>
    </div>
  `;
  document.getElementById('caseDetailDates').innerHTML = datesHtml;

  // Case file reference
  const folderParts = (caseItem.folder || '').split('/');
  const fileHtml = `
    <div style="font-size:13px;">
      <div style="background:var(--bg);padding:12px;border-radius:6px;margin-bottom:8px;">
        <div style="font-weight:600;margin-bottom:4px;"><i class="fas fa-folder-open" style="color:var(--gold);margin-right:6px;"></i>${esc(folderParts[folderParts.length - 1] || 'Unassigned')}</div>
        <div style="font-size:11px;color:var(--muted);">${esc(caseItem.folder || 'No file path')}</div>
      </div>
      <div style="font-size:11px;color:var(--muted);"><i class="fas fa-info-circle" style="margin-right:4px;"></i>Document management will sync case files here.</div>
    </div>
  `;
  document.getElementById('caseDetailFile').innerHTML = fileHtml;
}

function closeCaseDetail() {
  document.getElementById('caseDetailView').style.display = 'none';
  document.getElementById('casesListView').style.display = 'block';
}

function updateCaseTabCounts() {
  const counts = { '': casesData.length };
  const typeMap = {
    'general': 'General', 'probate-estate': 'Probate', 'family-law': 'Family',
    'criminal-defense': 'Criminal', 'personal-injury': 'PI', 'real-estate': 'RE', 'traffic': 'Traffic'
  };
  for (const key of Object.keys(typeMap)) {
    counts[key] = casesData.filter(c => c.case_type === key).length;
  }
  const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  el('tabCountAll', counts['']);
  el('tabCountGeneral', counts['general']);
  el('tabCountProbate', counts['probate-estate']);
  el('tabCountFamily', counts['family-law']);
  el('tabCountCriminal', counts['criminal-defense']);
  el('tabCountPI', counts['personal-injury']);
  el('tabCountRE', counts['real-estate']);
  el('tabCountTraffic', counts['traffic']);
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
  // Count only actual clients (exclude legal correspondents and admins)
  const realClients = clientsData.filter(c => (c.role || 'client') === 'client');
  document.getElementById('statClients').textContent = realClients.length;
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
  const typeFilter = (document.getElementById('contactTypeFilter')?.value || '');
  const catFilter = (document.getElementById('contactCategoryFilter')?.value || '');

  let filtered = clientsData.filter(c => (c.role || 'client') !== 'super_admin');

  if (typeFilter) {
    filtered = filtered.filter(c => (c.role || 'client') === typeFilter);
  }
  if (catFilter) {
    filtered = filtered.filter(c => (c.category || '') === catFilter);
  }
  if (search) {
    filtered = filtered.filter(c =>
      (c.first_name || '').toLowerCase().includes(search) ||
      (c.last_name || '').toLowerCase().includes(search) ||
      (c.email || '').toLowerCase().includes(search) ||
      (c.category || '').toLowerCase().includes(search)
    );
  }

  // Update count display
  const countEl = document.getElementById('contactsCount');
  if (countEl) {
    const clientCount = filtered.filter(c => (c.role || 'client') === 'client').length;
    const corrCount = filtered.filter(c => c.role === 'correspondent').length;
    countEl.textContent = `${filtered.length} shown · ${clientCount} clients, ${corrCount} correspondents`;
  }

  if (!filtered.length) {
    document.getElementById('contactsTable').innerHTML = emptyState('fas fa-users', clientsData.length ? 'No contacts match filters.' : 'No contacts yet.');
    return;
  }

  // Sort: clients first, then correspondents; alphabetical by last name within each
  filtered.sort((a, b) => {
    const roleA = (a.role || 'client') === 'client' ? 0 : 1;
    const roleB = (b.role || 'client') === 'client' ? 0 : 1;
    if (roleA !== roleB) return roleA - roleB;
    return (a.last_name || '').localeCompare(b.last_name || '');
  });

  const catLabels = {
    court: 'Court', prosecutor: 'Prosecutor', government: 'Government',
    legal_aid: 'Legal Aid', attorney: 'Attorney', insurance: 'Insurance',
    referral: 'Referral', expert: 'Expert', vendor: 'Vendor', bar: 'Bar', lead: 'Lead'
  };

  let html = `<table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Type</th><th>Category</th></tr></thead><tbody>`;
  filtered.forEach(c => {
    const role = c.role || 'client';
    const roleLabel = role === 'correspondent' ? 'Correspondent' : role === 'client' ? 'Client' : role;
    const cat = c.category || '';
    const catBadge = cat && cat !== 'lead'
      ? `<span class="badge-cat ${cat}">${esc(catLabels[cat] || cat)}</span>`
      : cat === 'lead'
      ? `<span class="badge-cat lead">Lead</span>`
      : '<span style="color:var(--muted);font-size:11px;">—</span>';
    const phone = c.phone || c.phone_number || '';
    html += `<tr>
      <td><strong>${esc(c.first_name || '')} ${esc(c.last_name || '')}</strong>${c.city ? `<br><span style="color:var(--muted);font-size:11px;">${esc(c.city)}${c.state ? ', ' + esc(c.state) : ''}</span>` : ''}</td>
      <td style="font-size:12px;">${esc(c.email || '')}</td>
      <td style="font-size:12px;color:var(--muted);">${esc(phone) || '—'}</td>
      <td><span class="badge-cat ${role === 'correspondent' ? 'attorney' : 'client'}">${esc(roleLabel)}</span></td>
      <td>${catBadge}</td>
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
  let html = `<table class="data-table"><thead><tr><th>Client</th><th>Description</th><th>Amount</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead><tbody>`;
  invoices.forEach(inv => {
    const userId = (inv.PK || '').replace('USER#', '');
    const invId = (inv.SK || '').replace('INV#', '');
    const isPaid = inv.status === 'paid';
    html += `<tr>
      <td><strong>${esc(inv.client_name || inv.email || '')}</strong></td>
      <td style="font-size:12px;">${esc(inv.description || '—')}</td>
      <td><strong>$${(inv.amount || 0).toFixed(2)}</strong></td>
      <td><span class="badge-stage ${isPaid ? 'converted' : 'new'}">${esc(inv.status || 'pending')}</span></td>
      <td style="font-size:12px;">${inv.created_at ? new Date(inv.created_at).toLocaleDateString() : ''}</td>
      <td>${isPaid ? '<span style="font-size:11px;color:var(--muted);"><i class="fas fa-check-circle"></i> Paid</span>' : `<button class="btn btn-sm btn-success" onclick="markInvoicePaid('${esc(userId)}','${esc(invId)}')" style="font-size:11px;"><i class="fas fa-check"></i> Mark Paid</button>`}</td>
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
  if (!clientsData.length) { sel.innerHTML = '<option value="">No contacts loaded</option>'; return; }

  const mkOption = (c) => {
    const uid = (c.PK || '').replace('USER#', '');
    const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || uid;
    return `<option value="${esc(uid)}" data-email="${esc(c.email||'')}" data-phone="${esc(c.phone||c.phone_number||'')}">${esc(name)}</option>`;
  };

  const clients = clientsData.filter(c => (c.role || 'client') === 'client');
  const correspondents = clientsData.filter(c => c.role === 'correspondent');

  let html = '';
  if (clients.length) {
    html += `<optgroup label="Clients">${clients.map(mkOption).join('')}</optgroup>`;
  }
  if (correspondents.length) {
    html += `<optgroup label="Legal Correspondents">${correspondents.map(mkOption).join('')}</optgroup>`;
  }
  sel.innerHTML = html || '<option value="">No contacts</option>';
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
// CASE CRUD (New, Edit, Close, Delete, Notes)
// ═══════════════════════════════════════════════════════════════

let currentCaseId = null;
let currentCaseUserId = null;

function setupCaseCrud() {
  // New Case button
  const newBtn = document.getElementById('newCaseBtn');
  if (newBtn) newBtn.addEventListener('click', openNewCaseForm);

  // Detail action buttons
  const editBtn = document.getElementById('editCaseBtn');
  const closeBtn = document.getElementById('closeCaseBtn');
  const deleteBtn = document.getElementById('deleteCaseBtn');
  const noteBtn = document.getElementById('addNoteBtn');
  if (editBtn) editBtn.addEventListener('click', openEditCaseForm);
  if (closeBtn) closeBtn.addEventListener('click', closeCaseAction);
  if (deleteBtn) deleteBtn.addEventListener('click', deleteCaseAction);
  if (noteBtn) noteBtn.addEventListener('click', openNoteForm);

  // Case form submit
  const caseForm = document.getElementById('caseForm');
  if (caseForm) caseForm.addEventListener('submit', submitCaseForm);

  // Note save
  const noteSaveBtn = document.getElementById('noteFormSaveBtn');
  if (noteSaveBtn) noteSaveBtn.addEventListener('click', saveNote);
}

function populateCaseClientDropdown() {
  const sel = document.getElementById('caseFormClient');
  if (!sel || !clientsData.length) return;
  const clients = clientsData.filter(c => (c.role || 'client') === 'client');
  sel.innerHTML = clients.map(c => {
    const uid = (c.PK || '').replace('USER#', '');
    const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email;
    return `<option value="${esc(uid)}">${esc(name)}</option>`;
  }).join('');
}

function openNewCaseForm() {
  document.getElementById('caseFormTitle').textContent = 'New Case';
  document.getElementById('caseFormId').value = '';
  document.getElementById('caseFormUserId').value = '';
  document.getElementById('caseFormType').value = 'general';
  document.getElementById('caseFormFolder').value = '';
  document.getElementById('caseFormNotes').value = '';
  document.getElementById('caseFormResult').innerHTML = '';
  document.getElementById('caseFormClient').disabled = false;
  populateCaseClientDropdown();
  new bootstrap.Modal(document.getElementById('caseFormModal')).show();
}

function openEditCaseForm() {
  const caseItem = casesData.find(c => {
    const id = c.case_id || (c.SK ? c.SK.replace('CASE#', '') : '');
    return id === currentCaseId;
  });
  if (!caseItem) return;
  document.getElementById('caseFormTitle').textContent = 'Edit Case';
  document.getElementById('caseFormId').value = currentCaseId;
  const userId = (caseItem.PK || '').replace('USER#', '');
  document.getElementById('caseFormUserId').value = userId;
  document.getElementById('caseFormType').value = caseItem.case_type || 'general';
  document.getElementById('caseFormFolder').value = caseItem.folder || '';
  document.getElementById('caseFormNotes').value = caseItem.notes || '';
  document.getElementById('caseFormResult').innerHTML = '';
  // Set client dropdown and disable it (can't move case between clients)
  populateCaseClientDropdown();
  document.getElementById('caseFormClient').value = userId;
  document.getElementById('caseFormClient').disabled = true;
  new bootstrap.Modal(document.getElementById('caseFormModal')).show();
}

async function submitCaseForm(e) {
  e.preventDefault();
  const btn = document.getElementById('caseFormSubmitBtn');
  const result = document.getElementById('caseFormResult');
  const caseId = document.getElementById('caseFormId').value;
  const userId = document.getElementById('caseFormUserId').value || document.getElementById('caseFormClient').value;

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
  result.innerHTML = '';

  try {
    if (caseId) {
      // Edit existing
      await PortalAPI.admin.updateCase({
        user_id: userId,
        case_id: caseId,
        case_type: document.getElementById('caseFormType').value,
        folder: document.getElementById('caseFormFolder').value,
        notes: document.getElementById('caseFormNotes').value,
      });
      result.innerHTML = '<span style="color:var(--success);"><i class="fas fa-check"></i> Case updated.</span>';
    } else {
      // Create new
      await PortalAPI.admin.createCase({
        user_id: userId,
        case_type: document.getElementById('caseFormType').value,
        folder: document.getElementById('caseFormFolder').value,
        notes: document.getElementById('caseFormNotes').value,
      });
      result.innerHTML = '<span style="color:var(--success);"><i class="fas fa-check"></i> Case created.</span>';
    }
    // Reload cases
    await loadCases();
    updateStats();
    // Close modal after short delay
    setTimeout(() => {
      bootstrap.Modal.getInstance(document.getElementById('caseFormModal'))?.hide();
      if (caseId) openCaseDetail(caseId); // refresh detail view
    }, 800);
  } catch (err) {
    result.innerHTML = `<span style="color:var(--danger);"><i class="fas fa-exclamation-circle"></i> ${esc(err.message)}</span>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Save Case';
  }
}

async function closeCaseAction() {
  if (!confirm('Close this case? It will be marked as closed.')) return;
  const caseItem = casesData.find(c => {
    const id = c.case_id || (c.SK ? c.SK.replace('CASE#', '') : '');
    return id === currentCaseId;
  });
  if (!caseItem) return;
  const userId = (caseItem.PK || '').replace('USER#', '');
  try {
    await PortalAPI.admin.updateCase({
      user_id: userId,
      case_id: currentCaseId,
      status: 'closed',
      closed_at: new Date().toISOString(),
    });
    await loadCases();
    updateStats();
    openCaseDetail(currentCaseId);
  } catch (err) { alert('Failed: ' + err.message); }
}

async function deleteCaseAction() {
  if (!confirm('Permanently delete this case? This cannot be undone.')) return;
  const caseItem = casesData.find(c => {
    const id = c.case_id || (c.SK ? c.SK.replace('CASE#', '') : '');
    return id === currentCaseId;
  });
  if (!caseItem) return;
  const userId = (caseItem.PK || '').replace('USER#', '');
  try {
    await PortalAPI.admin.deleteCase({ user_id: userId, case_id: currentCaseId });
    await loadCases();
    updateStats();
    closeCaseDetail();
  } catch (err) { alert('Failed: ' + err.message); }
}

function openNoteForm() {
  const caseItem = casesData.find(c => {
    const id = c.case_id || (c.SK ? c.SK.replace('CASE#', '') : '');
    return id === currentCaseId;
  });
  document.getElementById('noteFormText').value = caseItem?.notes || '';
  document.getElementById('noteFormResult').innerHTML = '';
  new bootstrap.Modal(document.getElementById('noteFormModal')).show();
}

async function saveNote() {
  const caseItem = casesData.find(c => {
    const id = c.case_id || (c.SK ? c.SK.replace('CASE#', '') : '');
    return id === currentCaseId;
  });
  if (!caseItem) return;
  const userId = (caseItem.PK || '').replace('USER#', '');
  const notes = document.getElementById('noteFormText').value;
  const result = document.getElementById('noteFormResult');
  try {
    await PortalAPI.admin.updateCase({ user_id: userId, case_id: currentCaseId, notes });
    result.innerHTML = '<span style="color:var(--success);"><i class="fas fa-check"></i> Saved.</span>';
    await loadCases();
    openCaseDetail(currentCaseId);
    setTimeout(() => bootstrap.Modal.getInstance(document.getElementById('noteFormModal'))?.hide(), 600);
  } catch (err) {
    result.innerHTML = `<span style="color:var(--danger);">${esc(err.message)}</span>`;
  }
}

// ═══════════════════════════════════════════════════════════════
// INVOICE CRUD
// ═══════════════════════════════════════════════════════════════

function setupInvoiceCrud() {
  const newBtn = document.getElementById('newInvoiceBtn');
  if (newBtn) newBtn.addEventListener('click', openNewInvoiceForm);
  const form = document.getElementById('invoiceForm');
  if (form) form.addEventListener('submit', submitInvoiceForm);
}

function populateInvoiceClientDropdown() {
  const sel = document.getElementById('invoiceFormClient');
  if (!sel || !clientsData.length) return;
  const clients = clientsData.filter(c => (c.role || 'client') === 'client');
  sel.innerHTML = clients.map(c => {
    const uid = (c.PK || '').replace('USER#', '');
    const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email;
    return `<option value="${esc(uid)}">${esc(name)}</option>`;
  }).join('');
}

function openNewInvoiceForm() {
  document.getElementById('invoiceFormAmount').value = '';
  document.getElementById('invoiceFormDesc').value = '';
  document.getElementById('invoiceFormDue').value = '';
  document.getElementById('invoiceFormResult').innerHTML = '';
  populateInvoiceClientDropdown();
  new bootstrap.Modal(document.getElementById('invoiceFormModal')).show();
}

async function submitInvoiceForm(e) {
  e.preventDefault();
  const btn = document.getElementById('invoiceFormSubmitBtn');
  const result = document.getElementById('invoiceFormResult');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
  result.innerHTML = '';
  try {
    await PortalAPI.admin.createInvoice({
      user_id: document.getElementById('invoiceFormClient').value,
      amount: parseFloat(document.getElementById('invoiceFormAmount').value),
      description: document.getElementById('invoiceFormDesc').value,
      due_date: document.getElementById('invoiceFormDue').value || null,
    });
    result.innerHTML = '<span style="color:var(--success);"><i class="fas fa-check"></i> Invoice created.</span>';
    await loadInvoices();
    setTimeout(() => bootstrap.Modal.getInstance(document.getElementById('invoiceFormModal'))?.hide(), 800);
  } catch (err) {
    result.innerHTML = `<span style="color:var(--danger);"><i class="fas fa-exclamation-circle"></i> ${esc(err.message)}</span>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-file-invoice-dollar"></i> Create Invoice';
  }
}

async function markInvoicePaid(userId, invoiceId) {
  if (!confirm('Mark this invoice as paid?')) return;
  try {
    await PortalAPI.admin.updateInvoice({
      user_id: userId,
      invoice_id: invoiceId,
      status: 'paid',
      paid_at: new Date().toISOString(),
    });
    await loadInvoices();
  } catch (err) { alert('Failed: ' + err.message); }
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
window.openCaseDetail = openCaseDetail;
window.markInvoicePaid = markInvoicePaid;
