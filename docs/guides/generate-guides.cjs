/*
 * Generates the three freshlog instruction PDFs (student, mentor, admin).
 * Pure JS via pdfkit — no browser needed.
 *   Setup:  npm init -y && npm install pdfkit
 *   Run:    node generate-guides.cjs <outputDir>
 */
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const OUT = process.argv[2] || ".";
fs.mkdirSync(OUT, { recursive: true });

// One palette, two consumers that cannot read the stylesheet: an email client
// and this PDF generator. Both used to hand-copy their own hexes, and these
// had drifted to a different ink (#1f2937) and line (#e5e7eb) than the app's
// — and to an ORANGE brand, from before the brand was blue. See src/lib/brand.ts.
const { BRAND: PALETTE } = require("../../src/lib/brand.ts");
const BRAND = PALETTE.brand;
const INK = PALETTE.ink;
const MUTED = PALETTE.muted;
const LINE = PALETTE.line;
const TIPBG = PALETTE.brandSoft;

const MARGIN = 60;

function build({ file, title, subtitle, sections }) {
  const doc = new PDFDocument({ size: "LETTER", margin: MARGIN, bufferPages: true });
  const stream = fs.createWriteStream(path.join(OUT, file));
  doc.pipe(stream);

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const contentW = pageW - MARGIN * 2;
  const bottom = pageH - 72;

  const ensure = (h) => {
    if (doc.y + h > bottom) doc.addPage();
  };

  // ---- Title block (page 1) ----
  doc.rect(0, 0, pageW, 8).fill(BRAND);
  doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(13);
  doc.text("freshlog", MARGIN, 48);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(26);
  doc.text(title, MARGIN, 74);
  doc.fillColor(MUTED).font("Helvetica").fontSize(11);
  doc.text(subtitle, { width: contentW });
  doc.moveTo(MARGIN, doc.y + 12).lineTo(pageW - MARGIN, doc.y + 12).strokeColor(LINE).lineWidth(1).stroke();
  doc.y += 26;

  const heading = (n, text) => {
    // Room for the heading and the start of what it introduces, so a heading
    // is never the last line on a page.
    ensure(100);
    const y = doc.y;
    doc.circle(MARGIN + 9, y + 9, 10).fill(BRAND);
    // Centred on the circle and wide enough for "10", which wrapped at 8pt.
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(11).text(String(n), MARGIN - 1, y + 4, { width: 20, align: "center" });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(14).text(text, MARGIN + 28, y + 1, { width: contentW - 28 });
    doc.y = Math.max(doc.y, y + 22) + 6;
  };

  const para = (text) => {
    // A lead-in ("What you can practise:") stays with the list it introduces.
    ensure(text.endsWith(":") ? 100 : 26);
    doc.fillColor(INK).font("Helvetica").fontSize(10.5).text(text, MARGIN, doc.y, { width: contentW, lineGap: 2 });
    doc.y += 6;
  };

  const list = (items, numbered) => {
    doc.font("Helvetica").fontSize(10.5).fillColor(INK);
    items.forEach((it, i) => {
      ensure(24);
      const marker = numbered ? `${i + 1}.` : "•";
      const x = MARGIN + 6;
      const startY = doc.y;
      doc.fillColor(BRAND).font(numbered ? "Helvetica-Bold" : "Helvetica").text(marker, x, startY, { width: 16 });
      doc.fillColor(INK).font("Helvetica").text(it, x + 20, startY, { width: contentW - 26, lineGap: 2 });
      doc.y += 4;
    });
    doc.y += 4;
  };

  const tip = (text) => {
    doc.font("Helvetica").fontSize(10);
    const h = doc.heightOfString(text, { width: contentW - 44, lineGap: 2 }) + 20;
    ensure(h + 8);
    const y = doc.y;
    doc.roundedRect(MARGIN, y, contentW, h, 6).fill(TIPBG);
    doc.rect(MARGIN, y, 4, h).fill(BRAND);
    doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(9).text("TIP", MARGIN + 16, y + 10);
    doc.fillColor(INK).font("Helvetica").fontSize(10).text(text, MARGIN + 44, y + 9, { width: contentW - 60, lineGap: 2 });
    doc.y = y + h + 12;
  };

  for (const s of sections) {
    heading(s.n, s.heading);
    for (const b of s.blocks) {
      if (b.p) para(b.p);
      else if (b.steps) list(b.steps, true);
      else if (b.bullets) list(b.bullets, false);
      else if (b.tip) tip(b.tip);
    }
    doc.y += 6;
  }

  // ---- Footers on every page ----
  // Zero the bottom margin while drawing so pdfkit doesn't treat footer text
  // (below the content area) as an overflow and append blank pages.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.moveTo(MARGIN, pageH - 54).lineTo(pageW - MARGIN, pageH - 54).strokeColor(LINE).lineWidth(1).stroke();
    doc.fillColor(MUTED).font("Helvetica").fontSize(8);
    doc.text(`freshlog - ${title}`, MARGIN, pageH - 46, { width: contentW / 2, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, MARGIN + contentW / 2, pageH - 46, { width: contentW / 2, align: "right", lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }

  doc.end();
  return new Promise((res) => stream.on("finish", res));
}

const student = {
  file: "student-guide.pdf",
  title: "Student Guide",
  subtitle: "How to sign in, see your mentoring hours, and book sessions on freshlog.",
  sections: [
    { n: 1, heading: "Signing in", blocks: [
      { steps: [
        "Open the freshlog link your program shared with you.",
        'Click "Continue with Google" and sign in with the email your program registered.',
        "The first time only: enter your full name and your Telegram username, then continue.",
      ] },
      { tip: "If you signed up yourself (your email wasn't pre-registered), an admin has to approve you first. You'll see a “registration received” message until then." },
    ] },
    { n: 2, heading: "Your hours (home page)", blocks: [
      { p: "The top strip summarises your hours:" },
      { bullets: [
        "Allotted — total hours granted to you.",
        "Completed — hours you've actually used in sessions.",
        "Missed — sessions you didn't show up to (still counted).",
        "Remaining — hours you can still use.",
        "Expired — hours that passed their deadline unused (only shown if you have any).",
      ] },
      { p: "Below that, “Hours with each mentor” shows your balance with every mentor, a progress bar, and the date you need to use them by." },
    ] },
    { n: 3, heading: "Deadlines matter", blocks: [
      { p: "Every block of hours has a use-by deadline. Book and use them before that date." },
      { tip: "Once a deadline passes, any unused hours in that block expire and can no longer be used. freshlog notifies you before the deadline and when it passes." },
    ] },
    { n: 4, heading: "Booking a session", blocks: [
      { steps: [
        'Go to "Book a session".',
        "Each mentor card shows how many hours you have left with them and a booking button (their own calendar).",
        "Book a time. After the session, your mentor logs it and it appears in your session history.",
      ] },
    ] },
    { n: 5, heading: "Missed sessions (no-shows)", blocks: [
      { p: "If you miss a session you booked, your mentor can mark you as absent. Those hours are still deducted and shown as “missed” — so try not to miss, and let your mentor know in advance if plans change." },
    ] },
    { n: 6, heading: "Notifications", blocks: [
      { p: "The bell icon (top-right) collects everything important: hours granted, sessions logged, deadline reminders, and approval updates. A red dot means you have unread items." },
    ] },
  ],
};

const mentor = {
  file: "mentor-guide.pdf",
  title: "Mentor Guide",
  subtitle: "How to sign in, share your booking link, and log sessions on freshlog.",
  sections: [
    { n: 1, heading: "Signing in", blocks: [
      { steps: [
        'Open freshlog and click "Continue with Google".',
        "Sign in with your @freshman.academy account. Enter your full name if asked.",
      ] },
      { tip: "If your account is brand new you'll see “not yet assigned to a program.” An admin needs to assign you before students and session logging appear — check back shortly after." },
    ] },
    { n: 2, heading: "Set your booking link", blocks: [
      { steps: [
        'On "My students", find the "Your booking links" panel.',
        "Paste your calendar link (e.g. Calendly, starting with https://) for each program you're assigned to, and save.",
        "Students in that program can now book you. Until you add a link they see “no booking link yet.”",
      ] },
    ] },
    { n: 3, heading: "Log a completed session", blocks: [
      { steps: [
        `Use the "Log a completed session" form on "My students" (or on a student's page).`,
        "Pick the student. Naming the task it went toward is optional — the list holds the tasks an admin allocated your hours for — but a meeting that fits none of them is still worth logging.",
        "Enter the hours and the date, and a note on what you covered.",
        'Say how it went: Attended, Came late, Absent, or Rescheduled.',
        'Click "Log session".',
      ] },
      { bullets: [
        "Attended — the ordinary case. The hours are charged.",
        "Came late — it happened; log the hours you actually spent.",
        "Absent — a no-show. The hours are still charged, but tracked separately as “missed” so everyone can see it.",
        "Rescheduled — the meeting moved, so no hours are charged. It stays in the log as a record.",
      ] },
      { tip: "Empty task list? No hours have been allocated to you for that student yet. Ask an admin — hours and the task they are for arrive together." },
    ] },
    { n: 4, heading: "Deadlines", blocks: [
      { p: "Each student's hours with you have a use-by date, shown in the “Use by” column and marked red once passed." },
      { tip: "After the deadline those hours expire — you can't log new sessions against them. Ask an admin to extend the deadline or allocate fresh hours." },
    ] },
    { n: 5, heading: "Fix or void a session", blocks: [
      { p: 'Click the pen on any session you logged — on the "Sessions" page, or on the student\'s own meetings log — to change the task it counted toward, its hours, date, notes, or how it went. Voiding it there returns the hours to the student and keeps the row as history. The student is notified of every change.' },
    ] },
    { n: 6, heading: "If a session has no task", blocks: [
      { p: "Log it anyway. An admin can attach it to a task later, and so can you with “Correct” once the task exists." },
    ] },
    { n: 7, heading: "Feedback & notifications", blocks: [
      { p: '"My feedback" shows the ratings students left you. The bell icon (top-right) collects your updates.' },
    ] },
  ],
};

const admin = {
  file: "admin-guide.pdf",
  title: "Admin Guide",
  subtitle: "Running programs on freshlog: students, hours, mentors, and your dual admin/mentor role.",
  sections: [
    { n: 1, heading: "The dashboard", blocks: [
      { p: 'Sign in with Google. The cross-program dashboard shows every program as a card with its students, mentors, and hours, plus a “Pending approvals” box when students are waiting. Click a program to open it.' },
      { p: "A program opens on three tabs: Overview (its numbers, what needs attention, the latest meetings, the tasks in flight, its mentors), Students (one row per student, click to open them), and Settings (name, cohorts, mentors, removing students, closing the program)." },
    ] },
    { n: 2, heading: "Add & approve students", blocks: [
      { steps: [
        "Open a program, go to the Students tab, and enter each student's email and full name; both are required. They confirm their Telegram on first sign-in.",
        "Click a student's name anywhere in the app to open their page.",
        'Students who signed up on their own appear under "Pending approvals" — approve them, then allocate their hours.',
      ] },
    ] },
    { n: 3, heading: "Assign a task, with the hours for it", blocks: [
      { p: "Assigning work and granting the hours for it are one act, so there is one form for both, at the foot of the Tasks panel." },
      { steps: [
        'Open a student from the Students tab and find "Assign a task" under Tasks.',
        "Pick the consultant, then the task (one of the presets or type your own), the hours, and the use-by date.",
        "Use the note to say what doing it well looks like — “review the intro of each essay” — and the consultant sees it under the task.",
        "For Master's Program students, also enter what they paid for these hours.",
        "The hours are added to what that consultant already holds with the student, and become the task's budget. Picking a task they already have open tops that budget up instead of starting a second copy of it.",
      ] },
      { tip: "Deadlines are enforced: once one passes, the unused hours expire and mentors can no longer log sessions against them. Extend the deadline to reopen them." },
      { tip: "To fix a mistake rather than grant more, use the ⋮ menu on the mentor's row in \u201cHours by mentor\u201d — it sets the total hours, the use-by date and the amount paid. Raising the total there also asks which task the extra hours are for." },
    ] },
    { n: 4, heading: "Tasks — what the hours are for", blocks: [
      { p: "Hours are always granted for a task, so the plan and the ledger are the same thing seen from two sides: the task carries the hours as its budget, and the mentor logs each session against one of the student's tasks." },
      { bullets: [
        "The Tasks panel on a student's page shows each task, its consultant, hours logged against hours budgeted, its deadline and its progress.",
        "Progress follows the hours on its own: the first session moves a task to In progress, reaching the budget marks it Done. Setting progress by hand pins it there.",
        "A task always arrives with hours, because a task nobody has hours for can't be worked on.",
        "Going over a task's budget is warned, never blocked — the number turns amber.",
      ] },
    ] },
    { n: 5, heading: "Register & assign mentors", blocks: [
      { steps: [
        'Open the "Mentors" page to register a new mentor by email + name + the programs they work in, or click Edit to change an existing mentor\'s assignments.',
        "A program's Settings tab does the same from the other side: assign any mentor to that program (or one of its cohorts), or remove them.",
        "Mentors set their own booking links after they're assigned.",
      ] },
      { tip: "Allocating a student hours from a mentor who isn't in their program yet assigns them to it automatically." },
      { tip: "Any admin can assign any mentor — including other admins and yourself — to any program. The five admins are also mentors, so they appear in this list too." },
    ] },
    { n: 6, heading: "Program settings", blocks: [
      { bullets: [
        "Rename the program. (The Master's billing rule matches on the name, so renaming that one turns it off.)",
        "Add cohorts — programs are flat until you do — or delete an empty one.",
        "Assign or remove its mentors.",
        "Remove a student, which deletes their account, enrollment, allocations and tasks. Blocked once they have a logged session: at that point the record is part of the hour ledger.",
        "Close the program down, once no students or scoped staff are left in it.",
      ] },
    ] },
    { n: 7, heading: "Switch between Admin and Mentor", blocks: [
      { p: "You are both an admin and a mentor. Use the Admin / Mentor toggle in the top-left of the header to switch dashboards." },
      { p: "In Mentor view you log your own sessions and set booking links like any mentor — once an admin (you or another) has assigned you to a program." },
    ] },
    { n: 8, heading: "Reading the numbers", blocks: [
      { bullets: [
        "Allotted — total hours granted.",
        "Completed — hours actually delivered.",
        "Missed — no-show hours (charged but not delivered).",
        "Expired — unused hours past their deadline.",
        "Remaining — hours still usable (allotted minus completed, missed, and expired).",
      ] },
    ] },
    { n: 9, heading: "Correcting and removing logged sessions", blocks: [
      { p: "Every meetings log — on the dashboard, on a program, on a student — has a pen on each row for admins. It says what it does when you hover it." },
      { bullets: [
        "Correct — change the task, hours, date, notes, or how the meeting went. The hours move with it.",
        "Void — keeps the row in the history and hands the hours back. This is what a mentor can do to their own sessions.",
        "Delete — removes the row outright, hours included. For rows that should never have been there: a duplicate from the spreadsheet import, a meeting logged on the wrong student. Available on voided rows too, which is how an old voided line finally leaves the log.",
      ] },
      { tip: "Prefer voiding when the meeting really happened. The log is the record of what was delivered, and a deleted row leaves no trace of itself." },
    ] },
    { n: 10, heading: "Nothing happens silently", blocks: [
      { p: "Every hour change, session, void, approval, and deadline event notifies the student (and the mentor where relevant) and lands in the bell. Allocation changes are also kept in an audit trail on the student's page." },
    ] },
  ],
};

const interviews = {
  file: "interview-guide.pdf",
  title: "Interview Practice Guide",
  subtitle: "How to offer a time, book a classmate, run a practice interview and give feedback on freshlog.",
  sections: [
    { n: 1, heading: "What practice interviews are", blocks: [
      { p: "Students rehearse admissions interviews on each other. You offer a few times, a classmate books one and picks what to practise, and at the time you take turns interviewing each other and then give each other feedback. No mentoring hours are used." },
      { bullets: [
        "You need an approved account. Everything lives under the Interviews tab.",
        "A classmate is a student who shares one of your own programs. Students you only visit on an exchange do not appear.",
        "All times are Tashkent time.",
      ] },
    ] },
    { n: 2, heading: "Offer a time", blocks: [
      { steps: [
        'Open Interviews, find "Your times" and press "Offer a time".',
        "Choose the day, the start time (Tashkent) and the length: 30, 45 or 60 minutes.",
        "Optional: paste a meeting link (Google Meet, Zoom) that starts with https://. Only you and the classmate who books will see it.",
        'Press "Add this time".',
      ] },
      { bullets: [
        "A time can be up to 60 days ahead and cannot be in the past.",
        "It cannot overlap anything already on your calendar: times you offered, or interviews you booked. Back to back is fine.",
        'Changed your mind? Press "Remove" on a time nobody has booked. Once somebody has booked it, cancel the interview instead (section 4).',
      ] },
      { tip: "Offer several times. Classmates can only book what is open, and a classmate with open times is listed first." },
    ] },
    { n: 3, heading: "Book a classmate's time", blocks: [
      { steps: [
        'Open Interviews and look under "Classmates". Those with times open are listed first, with how many. Open a name.',
        "Pick a time, then pick what to practise (see the list below).",
        'Press "Book with" and their first name. You land on the interview page, and your classmate is notified.',
      ] },
      { p: "What you can practise:" },
      { bullets: [
        "Freshman Interview Practice: Session 1. The school's first session: getting to know you, and why college.",
        "University admissions. An admissions officer or alumnus meeting an applicant.",
        "Scholarship panel. A funding panel deciding who to invest in.",
        "Behavioral (STAR). Questions answered as situation, task, action, result.",
        "Student visa. A consular officer checking study plans and ties to home.",
      ] },
      { p: "The questions are on the interview page as soon as it is booked, so you can read them ahead. If somebody books a time just before you, you will see that it is not available any more: pick another." },
      { tip: "The student who offered the time is the host and the one who booked it is the guest. It makes no difference in the session: you interview each other and both of you give feedback." },
    ] },
    { n: 4, heading: "Before the interview", blocks: [
      { bullets: [
        'Your booked interviews are under "Coming up" on the Interviews page. Open one to see the time, your partner and the questions.',
        'If a meeting link was offered, press "Join meeting". If not, arrange between you where to meet.',
        'Need to call it off? Open the interview, press "Cancel interview", then "Yes, cancel it". The time goes back to open and your partner is told. You can cancel until the interview is marked done or absent.',
      ] },
    ] },
    { n: 5, heading: "Run the interview", blocks: [
      { p: 'When the start time arrives, open the interview and press "Start interview" (it says "Continue interview" if you have already begun). Keep it open beside your call. You each use your own screen at your own pace, so talk to each other to stay in step.' },
      { steps: [
        "Introductions. Share your name, where you are from, and a little about what you have been up to this week.",
        "Review the feedback rubric. Read the four criteria together before you start (section 6).",
        "Interview practice. One question per screen. Take turns interviewing each other and listen carefully to your partner's answers. Type your own answer, or press Speak to dictate it where the button is shown.",
        "Partner feedback (section 7).",
      ] },
      { tip: "Your answers save as you click out of each box and when you press Next, so a closed tab loses at most the box you were typing in. Only you and the mentors you have worked with can read them (section 9)." },
    ] },
    { n: 6, heading: "The four criteria", blocks: [
      { p: "Use these to judge your partner's answers, and to know what is being looked at in yours." },
      { bullets: [
        "Content. How relevant, detailed and insightful was the response? Did your partner give specific examples? Did you learn something interesting?",
        "Flow and structure. Was it easy to follow? Were the ideas logically connected, or did your partner jump from point to point? Was there a clear structure?",
        "Grammar and language. Was the language accurate? Was the vocabulary appropriate and varied? Were there recurring mistakes?",
        "Confidence. Did your partner speak clearly and confidently, at a natural pace, without too many filler words and pauses?",
      ] },
    ] },
    { n: 7, heading: "Give your feedback", blocks: [
      { p: "The last step has three boxes, each up to 5,000 characters, and all three are required:" },
      { bullets: [
        "Summary. Briefly summarize your partner's answers.",
        "What went well. Always start with the positive. Highlight what your partner did particularly well.",
        "What to improve. Name areas for improvement and give specific, constructive suggestions.",
      ] },
      { steps: [
        "Talk your feedback through with your partner before you submit it.",
        'Press "Send feedback to" and your partner\'s name.',
      ] },
      { bullets: [
        "When you send, your partner is notified and can read it, and the interview counts as completed for both of you.",
        'Spotted a mistake? You can change what you sent until 30 minutes after the interview ends. Open the interview, find "Your feedback to" and their name, edit it and press "Save changes". The page shows the exact cut-off time. Your partner reads the new wording in place and is not told again.',
      ] },
      { tip: "The guide closes for you the moment you send, so finish your own answers first: after that only your feedback can be corrected, not your answers. Until you send, your feedback is a draft that saves as you type and that only you can see." },
    ] },
    { n: 8, heading: "After the interview", blocks: [
      { bullets: [
        'Your partner\'s feedback appears on the interview page under "Feedback from" their name. It says "Not sent yet" until they send it.',
        'Once the interview is done, a "Your notes" box opens: write how it went, which answers landed and what to work on next time, then press "Save notes". Only you can read it.',
        'Did the interview happen without anyone sending feedback? After the start time, either of you can press "Mark as done", then "Yes, it happened".',
        'Partner never joined? Once the interview has started, press "Mark absent", then "Yes, they didn\'t join". The interview closes for both of you without notes, and your partner is told. You can only mark your partner, never yourself. If you were the one marked absent, the interview page says so and the interview stays closed.',
        'Finished and closed interviews move to "Done" on the Interviews page, and your own answers stay on them.',
        "Interviews that have taken place also appear in your meetings log on Home and Meetings, marked as not counted toward your hours. Your hours balance does not change.",
      ] },
    ] },
    { n: 9, heading: "Who sees what", blocks: [
      { bullets: [
        "Only you: your feedback while it is still a draft. Your partner's answers and notes are theirs alone, and you never see them.",
        "You and the mentors you have worked with: your answers, your notes, and the feedback sent each way. The app says so under \"Your answers\" and \"Your notes\".",
        "You and your partner: the meeting link, and your feedback once you send it.",
        "Classmates: your name and the programs you share, and the times you have offered. Never your email address.",
      ] },
    ] },
    { n: 10, heading: "If something is not working", blocks: [
      { bullets: [
        "A classmate is missing: they must be approved, have their name filled in, and share one of your own programs.",
        '"You already have something at that time": the time overlaps one you offered or an interview you booked.',
        "No Start interview button: it appears at the start time and goes away once you have sent your feedback, or if the interview was marked absent.",
        "Your partner did not turn up: see \"Mark absent\" in section 8.",
        "Something did not save: check your connection and go back to the step the page names.",
      ] },
      { tip: "Practice interview updates land in the bell: a booking, a cancellation, feedback from your partner, and being marked absent." },
    ] },
  ],
};

(async () => {
  // Optional third argument builds one guide only: `node generate-guides.cjs <outDir> interviews`.
  // Without it all four are rebuilt, which rewrites every PDF.
  const only = process.argv[3];
  const guides = { student, mentor, admin, interviews };
  for (const [name, g] of Object.entries(guides)) if (!only || only === name) await build(g);
  console.log("Generated:", fs.readdirSync(OUT).filter((f) => f.endsWith(".pdf")).join(", "));
})();
