// AWS Cognito Authentication for Johnson Legal Team

// Runtime config comes from portal-config.js (window.PORTAL_CONFIG) when present,
// so the pool/client IDs live in ONE place after `sam deploy`. Falls back to
// inline values if that file is not loaded.
const _CFG = (typeof window !== 'undefined' && window.PORTAL_CONFIG) || {};
const COGNITO_CONFIG = {
    UserPoolId: _CFG.COGNITO_USER_POOL_ID || 'REPLACE_AFTER_DEPLOY',
    ClientId:   _CFG.COGNITO_CLIENT_ID    || 'REPLACE_AFTER_DEPLOY',
    Region:     _CFG.COGNITO_REGION       || 'us-east-1',
    Domain:     _CFG.COGNITO_DOMAIN       || '',
    RedirectUri: window.location.origin + '/client-login.html'
};

const ADMIN_EMAILS = ['mrtechfixes.ai@gmail.com', 'mrtechfixes@gmail.com', 'johnsonlegalteam@gmail.com'];

// Decode JWT payload without verifying signature (verification is server-side)
function decodeJwtPayload(token) {
    try {
        return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch { return null; }
}

// Derive role from ID token payload + admin email list
function getRoleFromPayload(payload, email) {
    if (!payload) return 'client';
    // Support Cognito Groups
    const groups = payload['cognito:groups'] || [];
    if (groups.includes('super_admin') || email === 'mrtechfixes.ai@gmail.com') return 'super_admin';
    if (groups.includes('admin') || ADMIN_EMAILS.includes(email)) return 'admin';
    return 'client';
}

function storeSession(tokens) {
    const payload = decodeJwtPayload(tokens.id_token);
    const email   = payload?.email || '';
    const role    = getRoleFromPayload(payload, email);

    localStorage.setItem('cognito_access_token',  tokens.access_token);
    localStorage.setItem('cognito_id_token',       tokens.id_token);
    localStorage.setItem('cognito_refresh_token',  tokens.refresh_token || '');
    localStorage.setItem('clientLoggedIn', 'true');
    localStorage.setItem('user_email', email);
    localStorage.setItem('user_role',  role);
    return { email, role };
}

function redirectByRole(email, role) {
    const router = new PortalRouter();
    router.redirectToPortal(email, role);
}

class CognitoAuth {
    constructor() {
        if (typeof AmazonCognitoIdentity === 'undefined') {
            console.error('AWS Cognito SDK not loaded');
            return;
        }
        this.userPool = new AmazonCognitoIdentity.CognitoUserPool({
            UserPoolId: COGNITO_CONFIG.UserPoolId,
            ClientId:   COGNITO_CONFIG.ClientId
        });
        this.init();
    }

    init() {
        // If OAuth callback code present, handle it first
        const params = new URLSearchParams(window.location.search);
        if (params.get('error')) {
            this.showError('Authentication failed: ' + params.get('error'));
            return;
        }
        if (params.get('code')) {
            this.exchangeCodeForTokens(params.get('code'));
            return;
        }

        // Check existing session
        const currentUser = this.userPool.getCurrentUser();
        if (currentUser) {
            currentUser.getSession((err, session) => {
                if (!err && session.isValid()) {
                    const email = localStorage.getItem('user_email') || '';
                    const role  = localStorage.getItem('user_role')  || 'client';
                    redirectByRole(email, role);
                }
            });
        }

        this.setupListeners();
    }

    setupListeners() {
        document.getElementById('loginForm')
            ?.addEventListener('submit', e => this.handleLogin(e));
        document.getElementById('registerForm')
            ?.addEventListener('submit', e => this.handleRegister(e));
    }

    async handleLogin(e) {
        e.preventDefault();
        const email    = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;
        const errorDiv = document.getElementById('loginError');
        errorDiv.classList.add('d-none');

        const authDetails = new AmazonCognitoIdentity.AuthenticationDetails({ Username: email, Password: password });
        const cognitoUser = new AmazonCognitoIdentity.CognitoUser({ Username: email, Pool: this.userPool });
        // TOTP association requires the CognitoUserSession internals; the SDK
        // uses this flag path when completing the software-token MFA setup.
        this._cognitoUser = cognitoUser;

        const finish = result => {
            const tokens = {
                access_token:  result.getAccessToken().getJwtToken(),
                id_token:      result.getIdToken().getJwtToken(),
                refresh_token: result.getRefreshToken().getToken()
            };
            const { email: e2, role } = storeSession(tokens);
            redirectByRole(e2, role);
        };
        const fail = msg => { errorDiv.textContent = msg; errorDiv.classList.remove('d-none'); };

        const callbacks = {
            onSuccess: finish,
            onFailure: err => {
                const msgs = {
                    UserNotConfirmedException: 'Please confirm your email before logging in.',
                    NotAuthorizedException:    'Invalid email or password.',
                    UserNotFoundException:     'No account found with that email.',
                    CodeMismatchException:     'Incorrect authentication code. Please try again.',
                    ExpiredCodeException:      'That code expired. Please enter a fresh code.'
                };
                fail(msgs[err.code] || ('Login failed: ' + (err.message || err.code || 'unknown error')));
            },
            newPasswordRequired: () => {
                const newPw = prompt('Set a new password (min 12 chars, upper/lower/number/symbol):');
                if (!newPw) return fail('A new password is required to continue.');
                cognitoUser.completeNewPasswordChallenge(newPw, {}, callbacks);
            },
            // First-time MFA: user must enroll a TOTP authenticator app.
            mfaSetup: () => {
                cognitoUser.associateSoftwareToken(callbacks);
            },
            associateSecretCode: (secretCode) => {
                const otpauth = `otpauth://totp/JohnsonLegalTeam:${encodeURIComponent(email)}?secret=${secretCode}&issuer=JohnsonLegalTeam`;
                MfaModal.openSetup(secretCode, otpauth)
                    .then(code => cognitoUser.verifySoftwareToken(code, 'JLT Authenticator', callbacks))
                    .catch(() => fail('Two-factor setup cancelled.'));
            },
            // Subsequent logins: prompt for the current TOTP code.
            totpRequired: () => {
                MfaModal.openVerify()
                    .then(code => cognitoUser.sendMFACode(code, callbacks, 'SOFTWARE_TOKEN_MFA'))
                    .catch(() => fail('Authentication code required.'));
            },
            selectMFAType: () => {
                cognitoUser.sendMFASelectionAnswer('SOFTWARE_TOKEN_MFA', callbacks);
            }
        };

        cognitoUser.authenticateUser(authDetails, callbacks);
    }

    async handleRegister(e) {
        e.preventDefault();
        const firstName = document.getElementById('firstName').value;
        const lastName  = document.getElementById('lastName').value;
        const email     = document.getElementById('registerEmail').value.trim();
        const phone     = document.getElementById('phone').value;
        const password  = document.getElementById('registerPassword').value;
        const confirm   = document.getElementById('confirmPassword').value;
        const errorDiv  = document.getElementById('registerError');
        const successDiv = document.getElementById('registerSuccess');

        errorDiv.classList.add('d-none');
        successDiv.classList.add('d-none');

        if (password !== confirm) {
            errorDiv.textContent = 'Passwords do not match.';
            errorDiv.classList.remove('d-none');
            return;
        }

        const attrs = [
            new AmazonCognitoIdentity.CognitoUserAttribute({ Name: 'email',       Value: email }),
            new AmazonCognitoIdentity.CognitoUserAttribute({ Name: 'given_name',  Value: firstName }),
            new AmazonCognitoIdentity.CognitoUserAttribute({ Name: 'family_name', Value: lastName }),
            new AmazonCognitoIdentity.CognitoUserAttribute({ Name: 'phone_number', Value: phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g,'')}` })
        ];

        this.userPool.signUp(email, password, attrs, null, (err) => {
            if (err) {
                const msgs = {
                    UsernameExistsException:   'An account with this email already exists.',
                    InvalidPasswordException:  'Password does not meet requirements.',
                    InvalidParameterException: 'Please check your input and try again.'
                };
                errorDiv.textContent = msgs[err.code] || 'Registration failed. Please try again.';
                errorDiv.classList.remove('d-none');
                return;
            }

            localStorage.setItem('pending_registration', JSON.stringify({ email, firstName, lastName, timestamp: Date.now() }));
            successDiv.textContent = 'Account created! Redirecting to onboarding...';
            successDiv.classList.remove('d-none');
            document.getElementById('registerForm').reset();
            setTimeout(() => { window.location.href = 'legal-onboarding.html?email=' + encodeURIComponent(email); }, 2500);
        });
    }

    async exchangeCodeForTokens(code) {
        try {
            const res = await fetch(`${COGNITO_CONFIG.Domain}/oauth2/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type:   'authorization_code',
                    client_id:    COGNITO_CONFIG.ClientId,
                    code,
                    redirect_uri: COGNITO_CONFIG.RedirectUri
                })
            });
            if (!res.ok) throw new Error('Token exchange failed');
            const tokens = await res.json();
            const { email, role } = storeSession(tokens);
            window.history.replaceState({}, '', window.location.pathname);
            redirectByRole(email, role);
        } catch (err) {
            console.error(err);
            this.showError('Google login failed. Please try again.');
        }
    }

    showError(msg) {
        const el = document.getElementById('loginError');
        if (el) { el.textContent = msg; el.classList.remove('d-none'); }
    }
}

// MFA modal controller: bridges the Cognito MFA callbacks to the Bootstrap
// modal in client-login.html. Each open* returns a Promise that resolves with
// the entered 6-digit code, or rejects if the user cancels.
const MfaModal = (function () {
    let modal = null, resolveFn = null, rejectFn = null;

    function el(id) { return document.getElementById(id); }

    function ensure() {
        const node = el('mfaModal');
        if (!node || typeof bootstrap === 'undefined') return null;
        if (!modal) {
            modal = new bootstrap.Modal(node);
            el('mfaSubmitBtn').addEventListener('click', submit);
            el('mfaCancelBtn').addEventListener('click', cancel);
            el('mfaCode').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
        }
        return modal;
    }

    function showError(msg) { const e = el('mfaError'); e.textContent = msg; e.classList.remove('d-none'); }
    function clearError() { el('mfaError').classList.add('d-none'); }

    function submit() {
        const code = (el('mfaCode').value || '').trim();
        if (!/^\d{6}$/.test(code)) { showError('Enter the 6-digit code.'); return; }
        const r = resolveFn; resolveFn = rejectFn = null;
        modal.hide();
        if (r) r(code);
    }

    function cancel() {
        const r = rejectFn; resolveFn = rejectFn = null;
        modal.hide();
        if (r) r(new Error('cancelled'));
    }

    function reset() {
        clearError();
        el('mfaCode').value = '';
    }

    function openSetup(secret, otpauthUri) {
        return new Promise((resolve, reject) => {
            const m = ensure();
            // Fallback to prompt() if the modal isn't on this page.
            if (!m) { const c = window.prompt('Add key to authenticator, then enter 6-digit code:\n' + secret); return c ? resolve(c) : reject(new Error('cancelled')); }
            resolveFn = resolve; rejectFn = reject;
            reset();
            el('mfaTitle').textContent = 'Set Up Two-Factor Authentication';
            el('mfaPrompt').textContent = 'Enter the 6-digit code from your app to finish setup:';
            el('mfaSetupSection').style.display = 'block';
            el('mfaSecret').textContent = secret;
            const qr = el('mfaQr'); qr.innerHTML = '';
            if (typeof QRCode !== 'undefined') new QRCode(qr, { text: otpauthUri, width: 180, height: 180 });
            else qr.innerHTML = '<span class="small text-muted">Use the manual key below.</span>';
            m.show();
            setTimeout(() => el('mfaCode').focus(), 300);
        });
    }

    function openVerify() {
        return new Promise((resolve, reject) => {
            const m = ensure();
            if (!m) { const c = window.prompt('Enter the 6-digit code from your authenticator app:'); return c ? resolve(c) : reject(new Error('cancelled')); }
            resolveFn = resolve; rejectFn = reject;
            reset();
            el('mfaTitle').textContent = 'Two-Factor Authentication';
            el('mfaPrompt').textContent = 'Enter the 6-digit code from your app:';
            el('mfaSetupSection').style.display = 'none';
            m.show();
            setTimeout(() => el('mfaCode').focus(), 300);
        });
    }

    return { openSetup, openVerify };
})();

function loginWithGoogle() {
    const redirectUri = COGNITO_CONFIG.RedirectUri;
    const url = `${COGNITO_CONFIG.Domain}/oauth2/authorize?` +
        `client_id=${COGNITO_CONFIG.ClientId}&response_type=code&scope=email+openid+profile` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}&identity_provider=Google`;

    console.group('[JLT Auth] Google OAuth Debug');
    console.log('window.location.origin:', window.location.origin);
    console.log('Redirect URI (raw):', redirectUri);
    console.log('Redirect URI (encoded):', encodeURIComponent(redirectUri));
    console.log('Full OAuth URL:', url);
    console.groupEnd();

    window.location.href = url;
}

function loginWithFacebook() { alert('Facebook login coming soon!'); }
function loginWithApple()    { alert('Apple login coming soon!'); }
function loginWithAmazon()   { alert('Amazon login coming soon!'); }

document.addEventListener('DOMContentLoaded', () => {
    function init() {
        if (typeof AmazonCognitoIdentity !== 'undefined') {
            window.cognitoAuth = new CognitoAuth();
        } else {
            setTimeout(init, 100);
        }
    }
    init();
});
