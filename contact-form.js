// Contact form handler for Johnson Legal Team.
// Submits leads to the Jude Leads Engine (serverless, no auth required for
// public submissions — see /jude-backend/leads). The backend classifies,
// scores, and stores the lead, then alerts firm staff.
(function () {
  'use strict';

  const LEADS_API = 'https://mpiai89295.execute-api.us-east-1.amazonaws.com/leads';

  const CASE_TYPE_MAP = {
    'Personal Injury': 'personal-injury',
    'Estate Planning & Probate': 'probate-estate-planning',
    'Expungements': 'expungements',
    'Misdemeanor Defense': 'misdemeanors',
    'Traffic Tickets': 'traffic-tickets',
    'Other': 'general',
  };

  document.addEventListener('DOMContentLoaded', () => {
    setupCaptcha();
    setupFormSubmit();
  });

  function setupCaptcha() {
    const a = Math.floor(Math.random() * 10) + 1;
    const b = Math.floor(Math.random() * 10) + 1;
    const question = document.getElementById('captchaQuestion');
    const correct = document.getElementById('captchaCorrect');
    if (question) question.textContent = `${a} + ${b}`;
    if (correct) correct.value = String(a + b);
  }

  function setupFormSubmit() {
    const form = document.getElementById('contactForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const statusEl = document.getElementById('formStatus');
      const submitBtn = document.getElementById('submitBtn');

      const captchaAnswer = document.getElementById('captchaAnswer').value.trim();
      const captchaCorrect = document.getElementById('captchaCorrect').value.trim();
      if (captchaAnswer !== captchaCorrect) {
        showStatus(statusEl, 'Incorrect security check answer. Please try again.', 'danger');
        setupCaptcha();
        document.getElementById('captchaAnswer').value = '';
        return;
      }

      const firstName = document.getElementById('firstName').value.trim();
      const lastName = document.getElementById('lastName').value.trim();
      const email = document.getElementById('email').value.trim();
      const phone = document.getElementById('phone').value.trim();
      const caseTypeLabel = document.getElementById('caseType').value;
      const urgency = document.getElementById('urgency').value;
      const message = document.getElementById('message').value.trim();
      const consent = document.getElementById('consent').checked;

      if (!firstName || !lastName || !email || !message || !consent) {
        showStatus(statusEl, 'Please fill out all required fields and provide consent.', 'danger');
        return;
      }

      const caseType = CASE_TYPE_MAP[caseTypeLabel] || 'general';
      const bodyParts = [
        message,
        phone ? `Phone: ${phone}` : null,
        urgency && urgency !== 'Select Urgency' ? `Urgency: ${urgency}` : null,
        caseTypeLabel && caseTypeLabel !== 'Select Case Type' ? `Case Type: ${caseTypeLabel}` : null,
      ].filter(Boolean);

      const payload = {
        from: email,
        subject: `Website inquiry from ${firstName} ${lastName}`,
        body: bodyParts.join('\n\n'),
        source: 'contact-form',
      };

      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending...';
      showStatus(statusEl, 'Sending your message...', 'info');

      try {
        const res = await fetch(LEADS_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) throw new Error(`Server responded ${res.status}`);
        await res.json();

        showStatus(statusEl, "Thank you! We've received your message and will contact you within 24 hours.", 'success');
        form.reset();
        setupCaptcha();
      } catch (err) {
        console.error('Contact form submission failed:', err);
        showStatus(statusEl, 'Sorry, something went wrong sending your message. Please call us at (313) 355-2216 or try again.', 'danger');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Message';
      }
    });
  }

  function showStatus(el, text, type) {
    if (!el) return;
    const colors = {
      success: { bg: '#d1fae5', color: '#065f46', border: '#34d399' },
      danger:  { bg: '#fee2e2', color: '#991b1b', border: '#f87171' },
      info:    { bg: '#dbeafe', color: '#1e40af', border: '#60a5fa' },
    };
    const c = colors[type] || colors.info;
    el.style.display = 'block';
    el.style.padding = '12px 16px';
    el.style.borderRadius = '6px';
    el.style.background = c.bg;
    el.style.color = c.color;
    el.style.border = `1px solid ${c.border}`;
    el.textContent = text;
  }
})();
