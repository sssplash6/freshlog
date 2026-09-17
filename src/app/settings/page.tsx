import { BookingLinksForm } from "@/components/forms/booking-link-form";
import { AvatarForm, OwnNameForm } from "@/components/forms/profile-forms";
import {
  NotificationMatrix,
  OwnTelegramForm,
  WeeklyDigestForm,
} from "@/components/forms/settings-forms";
import { PageTitle, Section } from "@/components/ui/section";
import { SettingsRow } from "@/components/ui/settings-row";
import {
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
          include: { program: true, cohort: true },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
    prisma.notificationPreference.findMany({ where: { userId: user.id } }),
  ]);
  const prefOf = new Map(prefs.map((p) => [p.category, p]));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
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
          <SettingsRow
            label="Sign-in email"
            control={<span className="text-sm text-ink">{user.email}</span>}
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

      <Section title="Notifications">
        <div className="px-4 py-2 sm:px-5">
          <WeeklyDigestForm defaultOn={user.weeklyDigest} />
        </div>
        <div className="border-t border-line px-4 py-2 sm:px-5">
          <NotificationMatrix
            categories={(
              Object.keys(NOTIFICATION_CATEGORY_LABELS) as NotificationCategory[]
            ).map((key) => ({
              key,
              label: NOTIFICATION_CATEGORY_LABELS[key],
              // No row is the default, and the default is in-app only.
              inApp: prefOf.get(key)?.inApp ?? true,
              email: prefOf.get(key)?.email ?? false,
            }))}
          />
        </div>
      </Section>
    </div>
  );
}
