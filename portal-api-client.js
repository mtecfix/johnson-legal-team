// Johnson Legal Team — Client Portal API client (frontend).
//
// Talks to the isolated serverless portal API (see /portal-api). The API
// verifies the Cognito JWT signature at the gateway; this client just needs to
// attach the current Cognito ID token as a Bearer credential.
//
// Configure API_BASE after `sam deploy` prints the ApiUrl output.
(function () {
  'use strict';

  const API_BASE = window.PORTAL_API_BASE || 'REPLACE_AFTER_DEPLOY';

  function getToken() {
    // Cognito ID token, set by the auth flow at login.
    return sessionStorage.getItem('cognito_id_token') || '';
  }

  // Token refresh using the Cognito refresh token (via InitiateAuth).
  let refreshing = null;
  async function refreshToken() {
    if (refreshing) return refreshing;
    const refreshTok = sessionStorage.getItem('cognito_refresh_token');
    if (!refreshTok) return false;
    refreshing = (async () => {
      try {
        const cfg = window.PORTAL_CONFIG || {};
        const region = cfg.COGNITO_REGION || 'us-east-1';
        const clientId = cfg.COGNITO_CLIENT_ID;
        if (!clientId) return false;
        const res = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
          body: JSON.stringify({
            AuthFlow: 'REFRESH_TOKEN_AUTH',
            ClientId: clientId,
            AuthParameters: { REFRESH_TOKEN: refreshTok },
          }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        const result = data.AuthenticationResult;
        if (result && result.IdToken) {
          sessionStorage.setItem('cognito_id_token', result.IdToken);
          if (result.AccessToken) sessionStorage.setItem('cognito_access_token', result.AccessToken);
          return true;
        }
        return false;
      } catch (_) { return false; }
      finally { refreshing = null; }
    })();
    return refreshing;
  }

  async function request(path, { method = 'GET', body = null } = {}) {
    const token = getToken();
    if (!token) { redirectToLogin(); throw new Error('Not authenticated'); }

    let res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    // On 401, attempt token refresh and retry once.
    if (res.status === 401) {
      const refreshed = await refreshToken();
      if (refreshed) {
        const newToken = getToken();
        res = await fetch(`${API_BASE}${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${newToken}`,
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      }
      if (res.status === 401) { redirectToLogin(); throw new Error('Session expired'); }
    }

    if (res.status === 403) throw new Error('You do not have permission to do that.');
    if (!res.ok) throw new Error(`API error ${res.status}`);
    // 204/empty-safe JSON parse.
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  function redirectToLogin() {
    try { sessionStorage.removeItem('cognito_id_token'); } catch (_) {}
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
      listCases:         ()      => request('/admin/cases'),
      createCase:        (data)  => request('/admin/cases', { method: 'POST', body: data }),
      updateCase:        (data)  => request('/admin/cases', { method: 'PUT', body: data }),
      deleteCase:        (data)  => request('/admin/cases', { method: 'DELETE', body: data }),
      listInvoices:      ()      => request('/admin/invoices'),
      createInvoice:     (data)  => request('/admin/invoices', { method: 'POST', body: data }),
      updateInvoice:     (data)  => request('/admin/invoices', { method: 'PUT', body: data }),
      listRegistrations: ()      => request('/admin/registrations'),
      decideRegistration:(data)  => request('/admin/registrations', { method: 'POST', body: data }),
      listUsers:         ()      => request('/admin/users'),
      changeRole:        (data)  => request('/admin/users', { method: 'PUT', body: data }), // super_admin only
      listMessages:      ()      => request('/admin/messages'),
      sendMessage:       (data)  => request('/admin/messages', { method: 'POST', body: data }),
      listAppointments:  ()      => request('/admin/appointments'),
      createAppointment: (data)  => request('/admin/appointments', { method: 'POST', body: data }),
    },

    _config: { API_BASE },
  };
})();
