// Portal Router - Directs users to appropriate portal based on role
class PortalRouter {
    routeUser(email, role) {
        // Admins and super-admins go to the admin dashboard; everyone else to
        // the client dashboard. (Role-specific UI is gated within each page,
        // and the API enforces authorization server-side.)
        if (role === 'super_admin' || role === 'admin') return 'admin-dashboard.html';
        return 'client-dashboard.html';
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
