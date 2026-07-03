// AWS Cognito Authentication for Johnson Legal Team

const COGNITO_CONFIG = {
    UserPoolId: 'us-east-1_3W53TuLIX',
    ClientId:   '247cl816m6hfs2mbkdc2193ko4',
    Domain:     'https://jlt-auth.auth.us-east-1.amazoncognito.com',
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

        cognitoUser.authenticateUser(authDetails, {
            onSuccess: result => {
                const tokens = {
                    access_token:  result.getAccessToken().getJwtToken(),
                    id_token:      result.getIdToken().getJwtToken(),
                    refresh_token: result.getRefreshToken().getToken()
                };
                const { email: e2, role } = storeSession(tokens);
                redirectByRole(e2, role);
            },
            onFailure: err => {
                const msgs = {
                    UserNotConfirmedException: 'Please confirm your email before logging in.',
                    NotAuthorizedException:    'Invalid email or password.',
                    UserNotFoundException:     'No account found with that email.'
                };
                errorDiv.textContent = msgs[err.code] || 'Login failed. Please try again.';
                errorDiv.classList.remove('d-none');
            },
            newPasswordRequired: () => {
                const newPw = prompt('Please set a new password:');
                if (!newPw) return;
                cognitoUser.completeNewPasswordChallenge(newPw, {}, {
                    onSuccess: result => {
                        const tokens = {
                            access_token:  result.getAccessToken().getJwtToken(),
                            id_token:      result.getIdToken().getJwtToken(),
                            refresh_token: result.getRefreshToken().getToken()
                        };
                        const { email: e2, role } = storeSession(tokens);
                        redirectByRole(e2, role);
                    },
                    onFailure: err => {
                        errorDiv.textContent = 'Password update failed: ' + err.message;
                        errorDiv.classList.remove('d-none');
                    }
                });
            }
        });
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

// Google OAuth redirect
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
