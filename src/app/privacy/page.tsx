import Link from "next/link";

import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy policy" };

/**
 * The privacy policy the App Store listing links to, so it is public: see
 * PUBLIC_PATHS in src/proxy.ts. Every line here has to stay true of the code.
 * A new kind of data, or a new service that sees it, changes this page in the
 * same commit, and the App Privacy answers in App Store Connect with it.
 */
export default function PrivacyPage() {
  return (
    <main className="flex min-h-full flex-1 justify-center bg-canvas px-4 py-12">
      <article className="w-full max-w-2xl rounded-2xl bg-surface p-6 shadow-sm sm:p-8">
        <div className="text-base font-bold tracking-tight text-brand">freshlog</div>
        <h1 className="mt-4 text-figure-lg font-bold leading-tight tracking-[-0.01em] text-ink">
          Privacy policy
        </h1>
        <p className="mt-1 text-body text-muted-fg">Last updated 28 October 2026</p>

        <div className="mt-6 space-y-3 text-body leading-relaxed text-ink [&_h2]:pt-4 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
          <p>
            freshlog is the app and website (www.freshlog.net) of Freshman Academy&apos;s
            mentoring programs, for their students, mentors and program staff. This page
            says what freshlog keeps about you, why, who else handles it, and how to have
            it deleted.
          </p>

          <h2>Your account</h2>
          <p>
            You sign in with Google. A new account does nothing until Freshman Academy adds
            it to one of its programs.
          </p>
          <ul>
            <li>
              Your name, email address, Google account ID and profile photo (from Google,
              or one you upload), and your role and programs.
            </li>
            <li>
              For students: the Telegram username you give at your first sign-in, and a
              link to your folder that your mentors add.
            </li>
          </ul>

          <h2>What you do in the programs</h2>
          <ul>
            <li>
              Sessions and their notes, hours, tasks, plans, classes, practice interviews
              and notifications, written by you or by your mentors and program staff.
            </li>
            <li>
              Ratings and feedback you give a mentor. Program staff read them; the mentor
              sees them without your name.
            </li>
            <li>
              Bug reports: what you write, a screenshot if you add one, and device details
              (app or browser version, screen size, light or dark mode).
            </li>
          </ul>

          <h2>On your phone and in your browser</h2>
          <ul>
            <li>
              The app keeps a sign-in token in your phone&apos;s secure storage, and a copy
              of what you last saw so it opens offline. Signing out removes both.
            </li>
            <li>
              If you allow notifications, the app sends freshlog a push token for that
              phone, which freshlog deletes when you sign out.
            </li>
            <li>The website sets one sign-in cookie.</li>
            <li>
              Photos are read only when you pick one, for your profile picture or a bug
              report.
            </li>
          </ul>

          <h2>What freshlog does not do</h2>
          <p>
            No advertising, no analytics or tracking tools, no tracking you across other
            apps or websites, and no selling or renting your data.
          </p>

          <h2>Who sees it</h2>
          <p>
            People in your programs see what their role needs: your mentors and program
            staff see your sessions, hours and tasks, and Freshman Academy&apos;s platform
            admins can see every account. These services handle data for freshlog and only
            to run it:
          </p>
          <ul>
            <li>Render, which hosts freshlog and its database in the United States.</li>
            <li>Cloudflare, the network in front of the website.</li>
            <li>
              Google, for sign-in. A mentor who connects Google Calendar also gives
              freshlog read-only access to their calendar events and Meet meetings, to
              draft session logs.
            </li>
            <li>Expo, Apple and Google, which deliver notifications to phones.</li>
            <li>Resend, which sends freshlog&apos;s emails, such as the weekly hours summary.</li>
            <li>
              OpenRouter, when a mentor dictates a session note: the recording is sent to
              turn it into text and is not stored by freshlog.
            </li>
          </ul>

          <h2>How long it is kept, and deleting it</h2>
          <p>
            Your data is kept while your account exists. Daily copies of the database are
            kept for 30 days.
          </p>
          <p>
            To delete your account, open Account in the app and tap Delete account, or
            email us. It is deleted within 30 days, and you can cancel until then. Copies
            made before the deletion expire within 30 more days.
          </p>

          <h2>Your choices</h2>
          <ul>
            <li>Turn off notifications by kind under Account, Notifications in the app, or all of them in your phone&apos;s settings.</li>
            <li>Turn off the weekly summary email in settings, or from any of those emails.</li>
            <li>Ask us for a copy of your data, or to correct it.</li>
          </ul>

          <h2>Contact</h2>
          <p>
            Freshman Academy,{" "}
            <a href="mailto:tech@freshman.academy" className="font-medium text-brand underline">
              tech@freshman.academy
            </a>
            . When this policy changes, this page and its date change with it.
          </p>
          <p>
            <Link href="/support" className="font-medium text-brand underline">
              Support
            </Link>
          </p>
        </div>
      </article>
    </main>
  );
}
