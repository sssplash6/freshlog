import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { ALLOWED_MENTOR_DOMAIN } from "../../config/app-config";
import { ROLES, USER_STATUS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

/**
 * Sign-in policy:
 * - Everyone authenticates with Google.
 * - Emails already in the User table (seeded staff, staff-created students,
 *   returning mentors/students) may sign in.
 * - Unknown emails on ALLOWED_MENTOR_DOMAIN self-register as UNASSIGNED
 *   mentors; an admin must assign them to a program before they can do
 *   anything. (Admins normally register mentors directly instead.)
 * - All other unknown emails self-register as PENDING students: they pick
 *   their program during onboarding, then wait for an admin to approve them
 *   and allocate mentor hours before anything counts. (Staff-registered
 *   emails skip this — they just confirm name + Telegram on first sign-in.)
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google") return false;
      const email = user.email?.toLowerCase();
      // Google can send a blank or all-space name. Stored as-is it is a name
      // that renders as nothing: every `name ?? email` fallback skips it.
      const name = user.name?.trim().replace(/\s+/g, " ") || null;
      if (!email) return false;
      // Google's own id for this account. A Google Meet participant arrives as
      // this id and never as an email, so it is how a meeting recognises who
      // was in it (lib/meet-drafts.ts).
      const googleId = account.providerAccountId || null;

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        // Backfill the name from Google for staff/students created by email only.
        if (!existing.name?.trim() && name) {
          await prisma.user.update({
            where: { id: existing.id },
            data: { name },
          });
        }
        if (googleId && existing.googleId !== googleId) {
          // Never fatal: a sign-in must not fail over a meeting-matching aid.
          await prisma.user
            .update({ where: { id: existing.id }, data: { googleId } })
            .catch((error) => console.error("[auth] googleId not recorded:", error));
        }
        return true;
      }

      // Unknown email on the staff domain: mentor self-sign-up.
      if (email.endsWith(`@${ALLOWED_MENTOR_DOMAIN}`)) {
        await prisma.user.create({
          data: {
            email,
            name,
            googleId,
            role: ROLES.MENTOR,
            status: USER_STATUS.UNASSIGNED,
          },
        });
        return true;
      }

      // Any other unknown email: student self-sign-up, pending approval.
      await prisma.user.create({
        data: {
          email,
          name,
          googleId,
          role: ROLES.STUDENT,
          status: USER_STATUS.PENDING,
        },
      });
      return true;
    },
    async jwt({ token, user }) {
      // On initial sign-in, pin the JWT to our DB user id. Role/status are
      // intentionally NOT stored in the token — the DAL reads them fresh from
      // the DB on every request, so admin changes (e.g. assigning a mentor)
      // take effect without re-login.
      if (user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email.toLowerCase() },
          select: { id: true },
        });
        if (dbUser) token.uid = dbUser.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      return session;
    },
  },
});
