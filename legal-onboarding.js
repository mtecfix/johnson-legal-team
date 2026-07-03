// Legal Onboarding Form Handler
class LegalOnboarding {
    constructor() {
        this.init();
    }

    init() {
        const form = document.getElementById('legalOnboardingForm');
        if (form) {
            form.addEventListener('submit', (e) => this.handleSubmit(e));
        }

        // Get user info from URL params or localStorage
        const urlParams = new URLSearchParams(window.location.search);
        this.userEmail = urlParams.get('email');

        const pending = localStorage.getItem('pending_registration');
        const pendingData = pending ? JSON.parse(pending) : {};

        if (!this.userEmail) this.userEmail = pendingData.email || '';
        this.firstName = pendingData.firstName || '';
        this.lastName  = pendingData.lastName  || '';

        if (!this.userEmail) {
            this.showError('Invalid access. Please register first.');
            return;
        }
    }

    async handleSubmit(event) {
        event.preventDefault();
        
        const errorDiv = document.getElementById('onboardingError');
        const successDiv = document.getElementById('onboardingSuccess');
        
        errorDiv.classList.add('d-none');
        successDiv.classList.add('d-none');

        // Collect form data
        const formData = {
            email:            this.userEmail,
            firstName:        this.firstName,
            lastName:         this.lastName,
            legalMatter:      document.getElementById('legalMatter').value,
            urgency: document.getElementById('urgency').value,
            caseDescription: document.getElementById('caseDescription').value,
            preferredContact: document.getElementById('preferredContact').value,
            bestTime: document.getElementById('bestTime').value,
            noAttorneyRelationship: document.getElementById('noAttorneyRelationship').checked,
            consentContact: document.getElementById('consentContact').checked,
            privacyPolicy: document.getElementById('privacyPolicy').checked,
            timeSensitive: document.getElementById('timeSensitive').checked,
            submittedAt: new Date().toISOString()
        };

        try {
            const response = await fetch('api/legal-onboarding.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            const result = await response.json();

            if (result.success) {
                successDiv.innerHTML = `
                    <h5><i class="fas fa-check-circle"></i> Legal Intake Complete!</h5>
                    <p>Thank you for completing your legal intake form. Your information has been submitted for attorney review.</p>
                    <p><strong>Next Steps:</strong></p>
                    <ul>
                        <li>Our legal team will review your information within 24 hours</li>
                        <li>You'll receive an email notification regarding your case</li>
                        <li>If we can assist you, we'll contact you to discuss representation</li>
                    </ul>
                    <p class="mb-0"><strong>For urgent matters, please call us immediately at (313) 355-2216</strong></p>
                `;
                successDiv.classList.remove('d-none');
                
                document.getElementById('legalOnboardingForm').reset();
                
                setTimeout(() => {
                    window.location.href = 'client-login.html?message=onboarding_complete';
                }, 5000);

            } else {
                errorDiv.textContent = result.error || 'Submission failed. Please try again.';
                errorDiv.classList.remove('d-none');
            }

        } catch (error) {
            console.error('Legal onboarding error:', error);
            errorDiv.textContent = 'Connection error. Please try again.';
            errorDiv.classList.remove('d-none');
        }
    }

    showError(message) {
        const errorDiv = document.getElementById('onboardingError');
        errorDiv.textContent = message;
        errorDiv.classList.remove('d-none');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new LegalOnboarding();
});
