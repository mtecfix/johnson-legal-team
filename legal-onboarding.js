// Legal Onboarding Form Handler
class LegalOnboarding {
    constructor() {
        this.init();
    }

    init() {
        const form = document.getElementById('legalOnboardingForm');
        if (form) form.addEventListener('submit', event => this.handleSubmit(event));

        const params = new URLSearchParams(window.location.search);
        let pendingData = {};
        try {
            pendingData = JSON.parse(sessionStorage.getItem('pending_registration') || '{}');
        } catch {
            sessionStorage.removeItem('pending_registration');
        }
        this.pendingData = pendingData;
        this.userEmail = (params.get('email') || pendingData.email || '').trim().toLowerCase();
        this.firstName = pendingData.firstName || '';
        this.lastName = pendingData.lastName || '';

        if (!this.userEmail) {
            this.showError('Invalid access. Please start registration first.');
            return;
        }

        // Carry forward information already entered on the registration page.
        const matter = document.getElementById('legalMatter');
        if (matter && pendingData.legalMatter) matter.value = pendingData.legalMatter;
        const description = document.getElementById('caseDescription');
        if (description && pendingData.caseDescription) description.value = pendingData.caseDescription;
        const referral = document.getElementById('referralSource');
        if (referral && pendingData.referralSource) referral.value = pendingData.referralSource;
    }

    async handleSubmit(event) {
        event.preventDefault();

        const errorDiv = document.getElementById('onboardingError');
        const successDiv = document.getElementById('onboardingSuccess');
        errorDiv.classList.add('d-none');
        successDiv.classList.add('d-none');

        const formData = {
            email: this.userEmail,
            firstName: this.firstName,
            lastName: this.lastName,
            phone: this.pendingData.phone || '',
            address: this.pendingData.address || '',
            city: this.pendingData.city || '',
            state: this.pendingData.state || '',
            zipCode: this.pendingData.zipCode || '',
            referralSource: this.pendingData.referralSource || '',
            legalMatter: document.getElementById('legalMatter').value,
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
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            const result = await response.json();

            if (response.ok && result.success) {
                sessionStorage.removeItem('pending_registration');
                successDiv.innerHTML = `
                    <h5><i class="fas fa-check-circle"></i> Legal Intake Complete!</h5>
                    <p>Thank you. Your information has been submitted for attorney review.</p>
                    <p><strong>Next Steps:</strong></p>
                    <ul>
                        <li>Our legal team will review your information.</li>
                        <li>We will contact you about next steps.</li>
                        <li>If portal access is approved, you will receive an account invitation.</li>
                    </ul>
                    <p class="mb-0"><strong>For urgent matters, please call (833) 659-8378.</strong></p>
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

document.addEventListener('DOMContentLoaded', () => new LegalOnboarding());
