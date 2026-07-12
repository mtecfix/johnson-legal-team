// Client Onboarding Form Handler
class OnboardingForm {
    constructor() {
        this.init();
    }

    init() {
        const form = document.getElementById('onboardingForm');
        if (form) {
            form.addEventListener('submit', (e) => this.handleSubmit(e));
        }

        // Get user info from URL params or localStorage
        const urlParams = new URLSearchParams(window.location.search);
        this.userEmail = urlParams.get('email');
        
        // If no email in URL, check localStorage for pending registration
        if (!this.userEmail) {
            const pending = localStorage.getItem('pending_registration');
            if (pending) {
                const data = JSON.parse(pending);
                this.userEmail = data.email;
            }
        }

        if (!this.userEmail) {
            this.showError('Invalid access. Please register first.');
            return;
        }

        // Generate simple token for this session
        this.userToken = btoa(this.userEmail + Date.now());
    }

    async handleSubmit(event) {
        event.preventDefault();
        
        const errorDiv = document.getElementById('onboardingError');
        const successDiv = document.getElementById('onboardingSuccess');
        
        // Clear previous messages
        errorDiv.classList.add('d-none');
        successDiv.classList.add('d-none');

        // Collect form data
        const formData = {
            token: this.userToken,
            email: this.userEmail,
            legalMatter: document.getElementById('legalMatter').value,
            urgency: document.getElementById('urgency').value,
            caseDescription: document.getElementById('caseDescription').value,
            preferredContact: document.getElementById('preferredContact').value,
            bestTime: document.getElementById('bestTime').value,
            referralSource: document.getElementById('referralSource').value,
            previousAttorney: document.getElementById('previousAttorney').value,
            additionalNotes: document.getElementById('additionalNotes').value,
            consentContact: document.getElementById('consentContact').checked,
            privacyPolicy: document.getElementById('privacyPolicy').checked,
            noAttorneyRelationship: document.getElementById('noAttorneyRelationship').checked,
            submittedAt: new Date().toISOString()
        };

        try {
            // Submit to backend API
            const response = await fetch('../api/onboarding.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            const result = await response.json();

            if (result.success) {
                successDiv.innerHTML = `
                    <h5><i class="fas fa-check-circle"></i> Onboarding Complete!</h5>
                    <p>Thank you for completing your onboarding form. Your information has been submitted for review.</p>
                    <p><strong>Next Steps:</strong></p>
                    <ul>
                        <li>Our team will review your information within 24 hours</li>
                        <li>You'll receive an email notification once your account is approved</li>
                        <li>After approval, you can access your client portal</li>
                    </ul>
                    <p class="mb-0">If you have urgent matters, please call us at <strong>(833) 659-8378</strong></p>
                `;
                successDiv.classList.remove('d-none');
                
                // Clear form
                document.getElementById('onboardingForm').reset();
                
                // Redirect after delay
                setTimeout(() => {
                    window.location.href = '../client-login.html?message=onboarding_complete';
                }, 5000);

            } else {
                errorDiv.textContent = result.error || 'Submission failed. Please try again.';
                errorDiv.classList.remove('d-none');
            }

        } catch (error) {
            console.error('Onboarding submission error:', error);
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

// Initialize onboarding form
document.addEventListener('DOMContentLoaded', () => {
    new OnboardingForm();
});
