import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db, one } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { makeLimiter, clientIp } from "@/lib/rate-limit";

/**
 * Brute-force brakes on the password check, two of them:
 *
 * - Per (IP, email) pair: five wrong passwords lock that pair for fifteen
 *   minutes. Keyed by the PAIR, never the email alone — an email-keyed
 *   lockout would let anyone lock a victim's account from anywhere just by
 *   spamming wrong passwords at their address (a lockout DoS). This way the
 *   attacker locks only their own address out; the real owner signs in
 *   normally from theirs.
 * - Per IP across all emails: an address probing many accounts (credential
 *   stuffing) loses login entirely for the window, so switching target
 *   emails does not buy fresh attempts.
 *
 * A correct password clears the pair's streak.
 */
const pairLockout = makeLimiter({ max: 5, windowMs: 15 * 60 * 1000 });
const ipFailures = makeLimiter({ max: 30, windowMs: 15 * 60 * 1000 });

/**
 * An unknown email must cost the same wall-clock time as a wrong password,
 * or the ~100ms bcrypt gap tells an attacker exactly which emails have
 * accounts. Comparing against this throwaway hash burns the same work.
 */
const TIMING_HASH = bcrypt.hashSync("timing-equalizer-not-a-password", 10);

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

        const ip = await clientIp();
        const pair = `${ip}|${email}`;
        if (pairLockout.isLimited(pair) || ipFailures.isLimited(ip)) return null;

        const fail = () => {
          // Unknown addresses count too, or the lockout itself would reveal
          // which emails exist.
          pairLockout.hit(pair);
          ipFailures.hit(ip);
          return null;
        };

        const user = await db.select().from(users).where(eq(users.email, email)).limit(1).then(one);
        if (!user) {
          await bcrypt.compare(password, TIMING_HASH);
          return fail();
        }
        // Deactivated accounts keep their history but lose their access.
        if (!user.active) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return fail();

        pairLockout.clear(pair);
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
