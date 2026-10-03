// Deployment configuration that is data, not code.
// Edit this file (not application code) to change the mentor sign-up domain,
// the fixed program list, or the staff preset list, then re-run the seed:
//   npx prisma db seed

/**
 * Only Google accounts on this domain may self-register as mentors.
 */
export const ALLOWED_MENTOR_DOMAIN = "freshman.academy";

/**
 * The Master's Program, by name, for the seed and the one-off importer.
 *
 * It is NO LONGER how the app decides whether a program bills per student —
 * that is `Program.tracksPayment`, a column, because this constant was being
 * compared against a program's name at four call sites and renaming the
 * program from its own settings page would have switched the money fields off
 * everywhere without a word.
 */
export const MASTERS_PROGRAM_NAME = "Master's Program";

/**
 * The pieces of work hours are normally granted for. Allocating hours names one
 * of these (or anything typed in its place), which is what the mentor then logs
 * every session against — so this list is the shared vocabulary of the two
 * halves of the app. Editing it changes what the pickers offer; tasks already
 * created keep the wording they were created with.
 */
export const TASK_PRESETS: string[] = [
  "Personal Statement Review",
  "Overall profile review and University advising",
  "Supplemental Essays",
  "Recommendation Essays & Bragsheets",
  "EC descriptions",
  "University Selection",
];

/**
 * Starter programs. Most are flat single programs — students belong to the
 * program directly. Admins can add cohorts (and whole programs) from the
 * dashboard when a program grows into them.
 *
 * Research is the leveled one: Emerging, Advanced and Frontiers are LEVELS
 * inside one program, each with its own standard grant — the merge script
 * folds the three old research programs into this same shape.
 */
export const PROGRAMS: {
  name: string;
  cohorts: string[];
  levels?: { name: string; standardMinutes: number; standardDays: number }[];
}[] = [
  { name: "Global Admissions Program", cohorts: [] },
  { name: "Flexible Program", cohorts: [] },
  { name: MASTERS_PROGRAM_NAME, cohorts: [] },
  {
    name: "Research Program",
    cohorts: [],
    // 90 days: the app's own "use within" default — editable per level on the
    // program's settings page.
    levels: [
      { name: "Emerging", standardMinutes: 120, standardDays: 90 },
      { name: "Advanced", standardMinutes: 900, standardDays: 90 },
      { name: "Frontiers", standardMinutes: 1200, standardDays: 90 },
    ],
  },
];

/**
 * The bootstrap admin, and nothing else.
 *
 * Staff used to be a list here, seeded on every deploy. They are rows now:
 * `User.platformAdmin` for the people who run the platform, and one
 * `ProgramStaff` row per program somebody administers, both written from
 * /settings/platform. That move had to take this list with it — `render.yaml`
 * runs the seed on every boot, so any admin still named here would be
 * re-created the next time the app restarted, however deliberately the owner
 * had removed them.
 *
 * What is left is the account that can make the others. It is seeded so a
 * fresh database is never locked out of its own platform page.
 */
export const STAFF_SEED: {
  email: string;
  name: string;
  role: "ADMIN";
  isMentor?: boolean;
  platformAdmin: true;
}[] = [
  {
    email: "tech@freshman.academy",
    name: "Freshman Academy Admin",
    role: "ADMIN",
    // Runs the platform and mentors students, so it carries both roles.
    isMentor: true,
    platformAdmin: true,
  },
];
