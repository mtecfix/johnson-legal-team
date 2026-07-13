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
        // role may come from caller or fall back to sessionStorage
        const resolvedRole = role || sessionStorage.getItem('user_role') || 'client';
        sessionStorage.setItem('user_email', email);
        sessionStorage.setItem('user_role',  resolvedRole);
        window.location.href = this.routeUser(email, resolvedRole);
    }
}

window.PortalRouter = PortalRouter;
