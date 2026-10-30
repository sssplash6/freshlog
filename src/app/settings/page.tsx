import { DensityChoice, ThemeChoice } from "@/components/display-choices";
import { BookingLinksForm } from "@/components/forms/booking-link-form";
import { AvatarForm, OwnNameForm } from "@/components/forms/profile-forms";
import {
  NotificationMatrix,
  OwnTelegramForm,
  WeeklyDigestForm,
} from "@/components/forms/settings-forms";
import { PageTitle, Section, READING_WIDTH } from "@/components/ui/section";
import { cn } from "@/lib/cn";
import { SettingsRow } from "@/components/ui/settings-row";
import {
  EMAIL_BY_DEFAULT,
  EMAIL_SENT,
  NOTIFICATION_CATEGORY_LABELS,
  canActAsMentor,
  type NotificationCategory,
} from "@/lib/constants";
import { disconnectGoogle } from "@/lib/actions/google";
import { buttonClasses } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { requireUser } from "@/lib/dal";
import { formatDate } from "@/lib/format";
import { googleConfigured } from "@/lib/google";
import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Settings" };

/**
 * Everything about you, in one place, whoever you are.
 *
 * These controls existed — scattered. The name and picture forms were on the
 * mentor's own profile page and gated on `canActAsMentor`, so a student could
 * not fix the spelling of their own name and an admin who does not mentor
 * could not have a picture. Booking links were a fold on the mentor home,
 * where they competed with the caseload. The weekly-email toggle was at the
 * bottom of the notification feed, which is a list of things that happened,
 * not a place anybody looks for a preference. A Telegram handle was captured
 * once at onboarding and never editable at all.
 *
 * Sections appear only when they are yours: a student has no booking links, a
 * mentor has no Telegram row.
 */
/**
 * An address that breaks after its "@" when it has to break at all, rather
 * than wherever the line runs out — "fresh / man.academy" is how a reader
 * learns a domain they will then mistype. `wrap-anywhere` on the parent is the
 * fallback for a half too long for one line by itself.
 */
function EmailText({ email }: { email: string }) {
  const at = email.indexOf("@");
  if (at < 0) return <>{email}</>;
  return (
    <>
      {email.slice(0, at)}
      <wbr />
      {email.slice(at)}
    </>
  );
}

/** What the Google consent round trip came back with, in the reader's words. */
const GOOGLE_RESULT: Record<string, string> = {
  connected: "Connected. Meetings that end from now on will arrive in Needs you.",
  denied: "Not connected: Google was not given access.",
  "wrong-account": "Not connected: use the Google account you sign in to Freshlog with.",
  "missing-scope": "Not connected: allow both Calendar and Meet on Google's screen.",
  failed: "Not connected: Google did not answer. Try again.",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const isMentor = canActAsMentor(user);
  const googleResult = (await searchParams).google;
  const showGoogle = isMentor && googleConfigured();

  const [profile, assignments, prefs, google] = await Promise.all([
    prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: { telegramUsername: true },
    }),
    isMentor
      ? prisma.mentorAssignment.findMany({
          where: { mentorId: user.id },
          include: { program: true, cohort: true, level: true },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
    prisma.notificationPreference.findMany({ where: { userId: user.id } }),
    showGoogle
      ? prisma.googleConnection.findUnique({ where: { userId: user.id } })
      : Promise.resolve(null),
  ]);
  const prefOf = new Map(prefs.map((p) => [p.category, p]));

  return (
    <div className={cn(READING_WIDTH, "space-y-4")}>
      <PageTitle title="Settings" />

      <Section title="Profile">
        <div className="px-4 py-2 sm:px-5">
          <SettingsRow
            label="Picture"
            control={
              <AvatarForm
                person={{
                  id: user.id,
                  name: user.name,
                  email: user.email,
                  avatarUpdatedAt: user.avatarUpdatedAt,
                }}
              />
            }
          />
          <OwnNameForm defaultName={user.name ?? ""} />
          {/* A field row, not a trailing one: an address is as long as it
              is, and pinned right in a phone's half-width it broke into
              "…@universit / y-mail.example.com". Here it lines up with the
              name above it and has the whole column. */}
          <SettingsRow
            label="Sign-in email"
            control={
              <p className="py-1 text-body text-muted-fg wrap-anywhere">
                <EmailText email={user.email} />
              </p>
            }
          />
          {/* In the profile card, not a "Contact" section of one row. */}
          {profile && <OwnTelegramForm defaultHandle={profile.telegramUsername ?? ""} />}
        </div>
      </Section>

      {/* Its own card, no Section around it: the form carries its own
          "Your booking links" title (it folds), and a "Booking links" heading
          above it named the same thing twice, one line apart. */}
      {isMentor && assignments.length > 0 && (
        <BookingLinksForm
          assignments={assignments.map((a) => ({
            id: a.id,
            label: a.cohort
              ? `${a.program.name} · ${a.cohort.name}`
              : a.program.name,
            calendlyUrl: a.calendlyUrl,
          }))}
        />
      )}

      {/* Mentors only, and only once Google is configured on this
          deployment. Connecting is a separate grant from signing in, so a
          student is never asked for their calendar. */}
      {showGoogle && (
        <Section id="google" title="Google Meet">
          <div className="px-4 py-2 sm:px-5">
            <SettingsRow
              label="Calendar and Meet"
              description={
                google
                  ? google.failedAt
                    ? "Google stopped accepting the connection. Reconnect to keep meetings arriving."
                    : google.lastSyncAt
                      ? `Connected as ${google.googleEmail}. Last checked ${formatDate(google.lastSyncAt)}.`
                      : `Connected as ${google.googleEmail}.`
                  : "When a Meet call with a student ends, it arrives in Needs you with the minutes and attendance filled in, for you to check and log."
              }
              state={
                typeof googleResult === "string" && GOOGLE_RESULT[googleResult] ? (
                  <p role="status" className="text-xs text-muted-fg">
                    {GOOGLE_RESULT[googleResult]}
                  </p>
                ) : undefined
              }
              control={
                google && !google.failedAt ? (
                  <form action={disconnectGoogle}>
                    <SubmitButton variant="secondary" pendingText="Disconnecting…">
                      Disconnect
                    </SubmitButton>
                  </form>
                ) : (
                  // A plain link, not `LinkButton`: this leaves the app for
                  // Google's consent screen, and a client-side transition to a
                  // route handler has nothing to render.
                  <a href="/api/google/connect" className={buttonClasses("primary", "md")}>
                    {google ? "Reconnect Google" : "Connect Google"}
                  </a>
                )
              }
            />
          </div>
        </Section>
      )}

      {/* Kept in this browser rather than on the account: a laptop at a desk
          and a phone on the bus want different answers, and neither choice is
          worth a round trip. The account menu carries the same two rows. */}
      <Section title="Display">
        <div className="px-4 py-2 sm:px-5">
          {/* Theme drops its hairline on a phone, where Density — the row
              under it — is hidden and the line would rule off nothing. */}
          <SettingsRow
            label="Theme"
            trailing
            className="max-sm:border-b-0"
            control={<ThemeChoice />}
          />
          <SettingsRow
            label="Density"
            trailing
            className="max-sm:hidden"
            control={<DensityChoice />}
          />
        </div>
      </Section>

      {/* `id` so the unsubscribe page can link straight here. */}
      <Section id="notifications" title="Notifications">
        {/* One list: the Monday email, then a row per category, hairlines
            between — not two blocks with a rule through the card. */}
        <div className="px-4 py-2 sm:px-5">
          <WeeklyDigestForm defaultOn={user.weeklyDigest} />
          <NotificationMatrix
            categories={(
              Object.keys(NOTIFICATION_CATEGORY_LABELS) as NotificationCategory[]
            ).map((key) => ({
              key,
              label: NOTIFICATION_CATEGORY_LABELS[key],
              // No row is the default: in the app always, by email only where
              // `EMAIL_BY_DEFAULT` says so.
              inApp: prefOf.get(key)?.inApp ?? true,
              email: prefOf.get(key)?.email ?? EMAIL_BY_DEFAULT[key],
              emailSent: EMAIL_SENT[key],
            }))}
          />
        </div>
      </Section>
    </div>
  );
}
