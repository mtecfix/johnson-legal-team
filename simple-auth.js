// Simple Authentication Handler for Johnson Legal Team
class SimpleAuth {
    constructor() {
        this.init();
    }

    init() {
        // Setup event listeners
        this.setupEventListeners();
        
        // Check if user is logged in
        if (localStorage.getItem('clientLoggedIn') === 'true') {
            const userEmail = localStorage.getItem('user_email');
            if (userEmail) {
                // Auto-approve admin users
                const autoApproveUsers = ['mrtechfixes.ai@gmail.com', 'mrtechfixes@gmail.com', 'johnsonlegalteam@gmail.com'];
                if (autoApproveUsers.includes(userEmail)) {
                    window.location.href = 'client-portal-cms.html';
                }
            }
        }
    }

    setupEventListeners() {
        // Login form
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        }

        // Register form
        const registerForm = document.getElementById('registerForm');
        if (registerForm) {
            registerForm.addEventListener('submit', (e) => this.handleRegister(e));
        }
    }

    async handleLogin(event) {
        event.preventDefault();
        
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        const errorDiv = document.getElementById('loginError');
        
        // Clear previous errors
        errorDiv.classList.add('d-none');

        // Simple validation
        if (!email || !password) {
            errorDiv.textContent = 'Please enter both email and password.';
            errorDiv.classList.remove('d-none');
            return;
        }

        try {
            // Auto-approve admin users
            const autoApproveUsers = ['mrtechfixes.ai@gmail.com', 'mrtechfixes@gmail.com', 'johnsonlegalteam@gmail.com'];
            
            if (autoApproveUsers.includes(email)) {
                // Store login info
                localStorage.setItem('clientLoggedIn', 'true');
                localStorage.setItem('user_email', email);
                
                // Check if user needs to complete registration
                this.checkRegistrationStatus(email);
            } else {
                // For regular users, check approval status
                const response = await fetch('api/check-approval.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email })
                });
                
                const result = await response.json();
                
                if (result.approved) {
                    localStorage.setItem('clientLoggedIn', 'true');
                    localStorage.setItem('user_email', email);
                    window.location.href = 'client-portal-cms.html';
                } else {
                    errorDiv.textContent = 'Your account is pending admin approval. You will receive an email once approved.';
                    errorDiv.classList.remove('d-none');
                }
            }

        } catch (error) {
            console.error('Login error:', error);
            errorDiv.textContent = 'Login error. Please try again.';
            errorDiv.classList.remove('d-none');
        }
    }

    async handleRegister(event) {
        event.preventDefault();
        
        const firstName = document.getElementById('firstName').value;
        const lastName = document.getElementById('lastName').value;
        const email = document.getElementById('registerEmail').value;
        const phone = document.getElementById('phone').value;
        const password = document.getElementById('registerPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        
        const errorDiv = document.getElementById('registerError');
        const successDiv = document.getElementById('registerSuccess');
        
        // Clear previous messages
        errorDiv.classList.add('d-none');
        successDiv.classList.add('d-none');

        // Validate passwords match
        if (password !== confirmPassword) {
            errorDiv.textContent = 'Passwords do not match.';
            errorDiv.classList.remove('d-none');
            return;
        }

        try {
            // Check if user should be auto-approved
            const autoApproveUsers = ['mrtechfixes.ai@gmail.com', 'mrtechfixes@gmail.com', 'johnsonlegalteam@gmail.com'];
            
            if (autoApproveUsers.includes(email)) {
                successDiv.textContent = 'Account created and approved! You can now log in.';
                successDiv.classList.remove('d-none');
                
                // Clear form and redirect to login
                document.getElementById('registerForm').reset();
                setTimeout(() => {
                    document.getElementById('login-tab').click();
                }, 2000);
            } else {
                successDiv.textContent = 'Account created! Please complete the legal onboarding process.';
                successDiv.classList.remove('d-none');
                
                // Clear form
                document.getElementById('registerForm').reset();
                
                // Store registration info for onboarding
                localStorage.setItem('pending_registration', JSON.stringify({
                    email: email,
                    firstName: firstName,
                    lastName: lastName,
                    timestamp: Date.now()
                }));
                
                // Redirect to legal onboarding
                setTimeout(() => {
                    window.location.href = 'legal-onboarding.html?email=' + encodeURIComponent(email);
                }, 3000);
            }

        } catch (error) {
            console.error('Registration error:', error);
            errorDiv.textContent = 'Registration error. Please try again.';
            errorDiv.classList.remove('d-none');
        }
    }

    logout() {
        localStorage.removeItem('clientLoggedIn');
        localStorage.removeItem('user_email');
        localStorage.removeItem('registration_complete');
        window.location.href = 'client-login.html';
    }

    async checkRegistrationStatus(email) {
        try {
            const response = await fetch('api/check-registration.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email })
            });
            
            const result = await response.json();
            
            if (result.registered) {
                // User already registered, go to portal
                window.location.href = 'client-portal-cms.html';
            } else {
                // First time user, go to registration
                window.location.href = 'user-registration.html';
            }
        } catch (error) {
            console.error('Registration check error:', error);
            // Default to registration form on error
            window.location.href = 'user-registration.html';
        }
    }
}

// Initialize authentication
document.addEventListener('DOMContentLoaded', () => {
    window.simpleAuth = new SimpleAuth();
});

// Global functions for buttons
function loginWithGoogle() { alert('Google login coming soon!'); }
function loginWithFacebook() { alert('Facebook login coming soon!'); }
function loginWithApple() { alert('Apple login coming soon!'); }
function loginWithAmazon() { alert('Amazon login coming soon!'); }
