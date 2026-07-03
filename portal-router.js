// Portal Router - Directs users to appropriate portal based on role
class PortalRouter {
    routeUser(email, role) {
        if (role === 'super_admin') return 'super-admin-portal.html';
        if (role === 'admin')       return 'admin-portal.html';
        return 'client-portal-cms.html';
    }

    redirectToPortal(email, role) {
        // role may come from caller or fall back to localStorage
        const resolvedRole = role || localStorage.getItem('user_role') || 'client';
        localStorage.setItem('user_email', email);
        localStorage.setItem('user_role',  resolvedRole);
        window.location.href = this.routeUser(email, resolvedRole);
    }
}

window.PortalRouter = PortalRouter;
