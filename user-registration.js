// User Registration Handler
class UserRegistration {
    constructor() {
        this.userEmail = null;
        this.userRole = null;
        this.init();
    }

    init() {
        // Get user info from localStorage
        this.userEmail = localStorage.getItem('user_email');
        
        if (!this.userEmail) {
            window.location.href = 'client-login.html';
            return;
        }

        // Determine user role
        this.userRole = this.getUserRole(this.userEmail);
        
        // Setup form based on role
        this.setupForm();
        
        // Setup form submission
        const form = document.getElementById('userRegistrationForm');
        if (form) {
            form.addEventListener('submit', (e) => this.handleSubmit(e));
        }
    }

    getUserRole(email) {
        const superUsers = ['mrtechfixes.ai@gmail.com'];
        const adminUsers = ['mrtechfixes@gmail.com', 'johnsonlegalteam@gmail.com'];
        
        if (superUsers.includes(email)) return 'super_admin';
        if (adminUsers.includes(email)) return 'admin';
        return 'client';
    }

    setupForm() {
        // Set email field
        document.getElementById('email').value = this.userEmail;
        
        // Update welcome message
        const welcomeMsg = document.getElementById('welcomeMessage');
        const roleLabel = this.userRole === 'super_admin' ? 'Super Administrator' : 
                         this.userRole === 'admin' ? 'Administrator' : 'Client';
        welcomeMsg.textContent = `Welcome ${roleLabel}! Please complete your profile information.`;
        
        // Show appropriate role fields
        document.querySelectorAll('.role-fields').forEach(el => el.classList.add('d-none'));
        
        if (this.userRole === 'super_admin') {
            document.getElementById('superAdminFields').classList.remove('d-none');
        } else if (this.userRole === 'admin') {
            document.getElementById('adminFields').classList.remove('d-none');
        } else {
            document.getElementById('clientFields').classList.remove('d-none');
        }
    }

    async handleSubmit(event) {
        event.preventDefault();
        
        const errorDiv = document.getElementById('registrationError');
        const successDiv = document.getElementById('registrationSuccess');
        
        errorDiv.classList.add('d-none');
        successDiv.classList.add('d-none');

        // Collect form data
        const formData = {
            email: this.userEmail,
            role: this.userRole,
            firstName: document.getElementById('firstName').value,
            lastName: document.getElementById('lastName').value,
            phone: document.getElementById('phone').value,
            address: document.getElementById('address').value,
            city: document.getElementById('city').value,
            state: document.getElementById('state').value,
            zipCode: document.getElementById('zipCode').value,
            registeredAt: new Date().toISOString()
        };

        // Add role-specific data
        if (this.userRole === 'client') {
            formData.companyName = document.getElementById('companyName').value;
            formData.preferredContact = document.getElementById('preferredContact').value;
            formData.timezone = document.getElementById('timezone').value;
        } else if (this.userRole === 'admin') {
            formData.department = document.getElementById('department').value;
            formData.jobTitle = document.getElementById('jobTitle').value;
            formData.permissions = {
                canManageClients: document.getElementById('canManageClients').checked,
                canManageCases: document.getElementById('canManageCases').checked,
                canManageBilling: document.getElementById('canManageBilling').checked
            };
        } else if (this.userRole === 'super_admin') {
            formData.accessLevel = document.getElementById('accessLevel').value;
            formData.emergencyContact = document.getElementById('emergencyContact').value;
            formData.systemRole = document.getElementById('systemRole').value;
        }

        try {
            const response = await fetch('api/user-registration.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            const result = await response.json();

            if (result.success) {
                successDiv.innerHTML = `
                    <h5><i class="fas fa-check-circle"></i> Registration Complete!</h5>
                    <p>Your profile has been successfully created. You now have full access to the system.</p>
                `;
                successDiv.classList.remove('d-none');
                
                // Mark registration as complete
                localStorage.setItem('registration_complete', 'true');
                
                // Redirect to appropriate portal
                setTimeout(() => {
                    window.location.href = 'client-dashboard.html';
                }, 2000);

            } else {
                errorDiv.textContent = result.error || 'Registration failed. Please try again.';
                errorDiv.classList.remove('d-none');
            }

        } catch (error) {
            console.error('Registration error:', error);
            errorDiv.textContent = 'Connection error. Please try again.';
            errorDiv.classList.remove('d-none');
        }
    }
}

// Initialize registration
document.addEventListener('DOMContentLoaded', () => {
    new UserRegistration();
});
