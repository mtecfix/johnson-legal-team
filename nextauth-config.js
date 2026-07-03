// NextAuth.js configuration for Cognito SSO
import NextAuth from 'next-auth'
import CognitoProvider from 'next-auth/providers/cognito'

export default NextAuth({
  providers: [
    CognitoProvider({
      clientId: process.env.COGNITO_CLIENT_ID,
      clientSecret: process.env.COGNITO_CLIENT_SECRET,
      issuer: process.env.COGNITO_ISSUER,
    })
  ],
  callbacks: {
    async jwt({ token, user, account }) {
      if (account && user) {
        // Store Cognito tokens
        token.accessToken = account.access_token
        token.refreshToken = account.refresh_token
        token.email = user.email
        
        // Determine user role
        const superUsers = ['mrtechfixes.ai@gmail.com']
        const adminUsers = ['mrtechfixes@gmail.com', 'johnsonlegalteam@gmail.com']
        
        if (superUsers.includes(user.email)) {
          token.role = 'super_admin'
        } else if (adminUsers.includes(user.email)) {
          token.role = 'admin'
        } else {
          token.role = 'client'
        }
      }
      return token
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken
      session.user.role = token.role
      session.user.email = token.email
      return session
    },
    async redirect({ url, baseUrl }) {
      // Check if user needs registration
      const response = await fetch(`${baseUrl}/api/check-registration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: session.user.email })
      })
      
      const result = await response.json()
      
      if (!result.registered) {
        return `${baseUrl}/user-registration`
      }
      
      return `${baseUrl}/client-portal-cms`
    }
  },
  pages: {
    signIn: '/client-login',
    error: '/auth/error'
  }
})
