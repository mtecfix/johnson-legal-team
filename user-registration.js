// Public client registration: collect contact details, then submit the legal intake.
// Cognito accounts are invite-only and are created by the firm after review.
class UserRegistration {
    constructor() {
        const form = document.getElementById('clientRegistrationForm');
        if (form) form.addEventListener('submit', event => this.handleSubmit(event));
    }

    showError(message) {
        const error = document.getElementById('registrationError');
        error.textContent = message;
        error.classList.remove('d-none');
    }

    async handleSubmit(event) {
        event.preventDefault();
        const error = document.getElementById('registrationError');
        const success = document.getElementById('registrationSuccess');
        error.classList.add('d-none');
        success.classList.add('d-none');

        const value = id => (document.getElementById(id)?.value || '').trim();
        const email = value('email').toLowerCase();
        const firstName = value('firstName');
        const lastName = value('lastName');
        const phone = value('phone');

        if (!firstName || !lastName || !phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            this.showError('Enter your first and last name, a valid email address, and phone number.');
            return;
        }
        if (!document.getElementById('agreeTerms')?.checked) {
            this.showError('Please agree to the Terms of Service and Privacy Policy to continue.');
            return;
        }

        const matterMap = {
            'criminal-defense': 'criminal-defense',
            'personal-injury': 'personal-injury',
            'estate-planning': 'estate-planning',
            'traffic-tickets': 'traffic',
            'expungements': 'expungement',
            'misdemeanors': 'criminal-defense',
            'other': 'other'
        };
        const rawMatter = value('legalMatter');
        const pending = {
            email, firstName, lastName, phone,
            address: value('address'),
            city: value('city'),
            state: value('state'),
            zipCode: value('zipCode'),
            legalMatter: matterMap[rawMatter] || '',
            caseDescription: value('caseDescription'),
            referralSource: value('referralSource'),
            timestamp: Date.now()
        };

        sessionStorage.setItem('pending_registration', JSON.stringify(pending));
        success.textContent = 'Your contact details are saved. Continue to the legal intake and required disclosures. Portal access is created only after firm review.';
        success.classList.remove('d-none');

        setTimeout(() => {
            window.location.href = 'legal-onboarding.html?email=' + encodeURIComponent(email);
        }, 600);
    }
}

document.addEventListener('DOMContentLoaded', () => new UserRegistration());
