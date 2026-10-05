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
  NOTIFICATION_CATEGORY_LABELS,
  canActAsMentor,
  type NotificationCategory,
} from "@/lib/constants";
import { requireUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

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

export default async function SettingsPage() {
  const user = await requireUser();
  const isMentor = canActAsMentor(user);

  const [profile, assignments, prefs] = await Promise.all([
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
              <p className="py-1 text-[0.9375rem] text-muted-fg wrap-anywhere">
                <EmailText email={user.email} />
              </p>
            }
          />
        </div>
      </Section>

      {profile && (
        <Section title="Contact">
          <div className="px-4 py-2 sm:px-5">
            <OwnTelegramForm defaultHandle={profile.telegramUsername ?? ""} />
          </div>
        </Section>
      )}

      {isMentor && assignments.length > 0 && (
        <Section title="Booking links">
          <div className="px-4 py-2 sm:px-5">
            <BookingLinksForm
              bare
              assignments={assignments.map((a) => ({
                id: a.id,
                label: a.cohort
                  ? `${a.program.name} · ${a.cohort.name}`
                  : a.program.name,
                calendlyUrl: a.calendlyUrl,
              }))}
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
            description="Light or dark, for this browser."
            trailing
            className="max-sm:border-b-0"
            control={<ThemeChoice />}
          />
          <SettingsRow
            label="Density"
            description="How tightly tables and text pack on a larger screen. Phones always keep full-size controls."
            trailing
            className="max-sm:hidden"
            control={<DensityChoice />}
          />
        </div>
      </Section>

      <Section title="Notifications">
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
            }))}
          />
        </div>
      </Section>
    </div>
  );
}
