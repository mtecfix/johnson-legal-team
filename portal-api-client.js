// Johnson Legal Team — Client Portal API client (frontend).
//
// Talks to the isolated serverless portal API (see /portal-api). The API
// verifies the Cognito JWT signature at the gateway; this client just needs to
// attach the current Cognito ID token as a Bearer credential.
//
// Configure API_BASE after `sam deploy` prints the ApiUrl output.
(function () {
  'use strict';

  const API_BASE = window.PORTAL_API_BASE || 'https://REPLACE_WITH_API_ID.execute-api.us-east-1.amazonaws.com';

  function getToken() {
    // Cognito ID token, set by the auth flow at login.
    return localStorage.getItem('cognito_id_token') || '';
  }

  async function request(path, { method = 'GET', body = null } = {}) {
    const token = getToken();
    if (!token) { redirectToLogin(); throw new Error('Not authenticated'); }

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) { redirectToLogin(); throw new Error('Session expired'); }
    if (res.status === 403) throw new Error('You do not have permission to do that.');
    if (!res.ok) throw new Error(`API error ${res.status}`);
    // 204/empty-safe JSON parse.
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  function redirectToLogin() {
    try { localStorage.removeItem('cognito_id_token'); } catch (_) {}
    if (!/client-login\.html$/.test(location.pathname)) location.href = 'client-login.html';
  }

  // Public API surface — mirrors the portal-api routes.
  window.PortalAPI = {
    // Client
    getProfile:        ()      => request('/profile'),
    updateProfile:     (data)  => request('/profile', { method: 'PUT', body: data }),
    getCases:          ()      => request('/cases'),
    getDocuments:      ()      => request('/documents'),
    getMessages:       ()      => request('/messages'),
    sendMessage:       (data)  => request('/messages', { method: 'POST', body: data }),
    getInvoices:       ()      => request('/invoices'),
    getAppointments:   ()      => request('/appointments'),
    requestAppointment:(data)  => request('/appointments', { method: 'POST', body: data }),

    // Admin (require admin/super_admin — server enforces)
    admin: {
      listClients:       ()      => request('/admin/clients'),
      listInvoices:      ()      => request('/admin/invoices'),
      listRegistrations: ()      => request('/admin/registrations'),
      decideRegistration:(data)  => request('/admin/registrations', { method: 'POST', body: data }),
      listUsers:         ()      => request('/admin/users'),
      changeRole:        (data)  => request('/admin/users', { method: 'PUT', body: data }), // super_admin only
    },

    _config: { API_BASE },
  };
})();
