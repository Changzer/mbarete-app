import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Brute-force brake on the password check. Five wrong passwords for one
 * account locks that account's sign-in for fifteen minutes; a correct
 * password clears the count. In-memory on purpose: the app runs as a single
 * process, and a restart clearing the counters costs an attacker their
 * progress, not us our security.
 */
const LOCKOUT_AFTER = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const failedLogins = new Map<string, { count: number; lastFailAt: number }>();

function isLockedOut(email: string) {
  const entry = failedLogins.get(email);
  if (!entry) return false;
  if (Date.now() - entry.lastFailAt > LOCKOUT_MS) {
    failedLogins.delete(email);
    return false;
  }
  return entry.count >= LOCKOUT_AFTER;
}

function recordFailedLogin(email: string) {
  // Random probe emails must not grow the map forever.
  if (failedLogins.size > 1000) {
    for (const [key, entry] of failedLogins) {
      if (Date.now() - entry.lastFailAt > LOCKOUT_MS) failedLogins.delete(key);
    }
  }
  const entry = failedLogins.get(email);
  if (entry && Date.now() - entry.lastFailAt <= LOCKOUT_MS) {
    entry.count += 1;
    entry.lastFailAt = Date.now();
  } else {
    failedLogins.set(email, { count: 1, lastFailAt: Date.now() });
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = (credentials?.email as string | undefined)?.toLowerCase().trim();
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        if (isLockedOut(email)) return null;

        const user = db.select().from(users).where(eq(users.email, email)).get();
        if (!user) {
          // Unknown addresses count too, or the lockout itself would reveal
          // which emails exist.
          recordFailedLogin(email);
          return null;
        }
        // Deactivated accounts keep their history but lose their access.
        if (!user.active) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          recordFailedLogin(email);
          return null;
        }

        failedLogins.delete(email);
        return { id: String(user.id), email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});
