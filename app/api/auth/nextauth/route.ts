// app/api/auth/[...nextauth]/route.ts
import NextAuth, { NextAuthOptions } from 'next-auth';
import GitHubProvider from 'next-auth/providers/github';

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_ID || '',
      clientSecret: process.env.GITHUB_SECRET || '',
      // Запрашиваем "user:email" (по умолчанию) — логина достаточно
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      // Прокинем github login (удобно для allowlist)
      if (profile && (profile as any).login) {
        (token as any).login = (profile as any).login;
      }
      return token;
    },
    async session({ session, token }) {
      (session as any).user = session.user || {};
      (session as any).user.login = (token as any).login || null;
      return session;
    },
  },
  session: { strategy: 'jwt' },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
export { authOptions as GET_AUTH_OPTIONS }; // опционально
