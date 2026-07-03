// Enhanced authentication with NextAuth.js session management
import { useSession, signIn, signOut } from 'next-auth/react'

class EnhancedAuth {
    constructor() {
        this.init()
    }

    init() {
        // Check if user is authenticated
        const { data: session, status } = useSession()
        
        if (status === 'loading') {
            this.showLoading()
            return
        }
        
        if (status === 'unauthenticated') {
            this.redirectToLogin()
            return
        }
        
        if (session) {
            this.handleAuthenticatedUser(session)
        }
    }

    async handleGoogleLogin() {
        try {
            // Use NextAuth signIn with Cognito provider
            const result = await signIn('cognito', { 
                callbackUrl: '/client-portal-cms',
                redirect: false 
            })
            
            if (result?.error) {
                this.showError('Authentication failed: ' + result.error)
            }
        } catch (error) {
            console.error('Login error:', error)
            this.showError('Login failed. Please try again.')
        }
    }

    handleAuthenticatedUser(session) {
        // Store user info for compatibility with existing code
        localStorage.setItem('clientLoggedIn', 'true')
        localStorage.setItem('user_email', session.user.email)
        localStorage.setItem('user_role', session.user.role)
        
        // Update UI
        this.updateUserGreeting(session.user.email, session.user.role)
        
        // Check registration status (handled by NextAuth redirect callback)
        // User will be automatically redirected if registration needed
    }

    updateUserGreeting(email, role) {
        const greeting = document.getElementById('userGreeting')
        if (greeting) {
            const roleLabel = role === 'super_admin' ? 'Super Admin' : 
                             role === 'admin' ? 'Admin' : 'Client'
            greeting.textContent = `Welcome ${roleLabel}!`
        }
    }

    async logout() {
        // Clear local storage
        localStorage.removeItem('clientLoggedIn')
        localStorage.removeItem('user_email')
        localStorage.removeItem('user_role')
        localStorage.removeItem('registration_complete')
        
        // Use NextAuth signOut
        await signOut({ callbackUrl: '/client-login' })
    }

    showLoading() {
        const errorDiv = document.getElementById('loginError')
        if (errorDiv) {
            errorDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Authenticating...'
            errorDiv.className = 'alert alert-info'
            errorDiv.classList.remove('d-none')
        }
    }

    showError(message) {
        const errorDiv = document.getElementById('loginError')
        if (errorDiv) {
            errorDiv.textContent = message
            errorDiv.className = 'alert alert-danger'
            errorDiv.classList.remove('d-none')
        }
    }

    redirectToLogin() {
        if (window.location.pathname !== '/client-login') {
            window.location.href = '/client-login'
        }
    }
}

// Initialize enhanced auth
const enhancedAuth = new EnhancedAuth()

// Export for global use
window.enhancedAuth = enhancedAuth
