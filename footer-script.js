// Universal footer script for Johnson Legal Team
function updateNavigation() {
    const loginLink = document.getElementById('loginDashboardLink');
    const loginLinkFooter = document.getElementById('loginDashboardLinkFooter');
    
    if (sessionStorage.getItem('clientLoggedIn')) {
        if (loginLink) {
            loginLink.textContent = 'Dashboard';
            loginLink.href = 'client-dashboard.html';
        }
        if (loginLinkFooter) {
            loginLinkFooter.textContent = 'Dashboard';
            loginLinkFooter.href = 'client-dashboard.html';
        }
    } else {
        if (loginLink) {
            loginLink.textContent = 'Login';
            loginLink.href = 'client-login.html';
        }
        if (loginLinkFooter) {
            loginLinkFooter.textContent = 'Login';
            loginLinkFooter.href = 'client-login.html';
        }
    }
}

// Ensure social icons are present and styled correctly
function ensureSocialIcons() {
    // Look for the social icons div (the one without mb-2 class)
    const socialDivs = document.querySelectorAll('footer .d-flex.justify-content-md-end.align-items-center.flex-wrap');
    let socialDiv = null;
    
    // Find the div that doesn't have mb-2 class (should be the social icons div)
    socialDivs.forEach(div => {
        if (!div.classList.contains('mb-2') && !div.classList.contains('small')) {
            socialDiv = div;
        }
    });
    
    if (socialDiv && socialDiv.children.length === 0) {
        socialDiv.innerHTML = `
            <a href="https://www.linkedin.com/company/johnson-legal-team-birmingham" class="me-2" style="color: var(--accent-secondary) !important;"><i class="fab fa-linkedin-in"></i></a>
            <a href="https://maps.google.com/?q=1221+Bowers+St,+Birmingham,+MI+48012" class="me-2" style="color: var(--accent-secondary) !important;"><i class="fab fa-google"></i></a>
            <a href="https://www.facebook.com/JohnsonLegalTeamMI" class="me-2" style="color: var(--accent-secondary) !important;"><i class="fab fa-facebook-f"></i></a>
            <a href="https://www.instagram.com/johnsonlegalteam" style="color: var(--accent-secondary) !important;"><i class="fab fa-instagram"></i></a>
        `;
    }
    
    // Ensure Font Awesome is loaded
    if (!document.querySelector('link[href*="font-awesome"]')) {
        const fontAwesome = document.createElement('link');
        fontAwesome.rel = 'stylesheet';
        fontAwesome.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css';
        document.head.appendChild(fontAwesome);
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    updateNavigation();
    ensureSocialIcons();
    
    // Update navigation on storage change (for cross-tab login state)
    window.addEventListener('storage', function(e) {
        if (e.key === 'clientLoggedIn') {
            updateNavigation();
        }
    });
});
