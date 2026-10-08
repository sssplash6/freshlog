# Changelog

What we have added and fixed, newest first. Each commit that changes what you see or can do adds a line here.

Write each item as `**Headline.** One line of detail.` — the headline is what people skim.

## 2026-10-08

### New
- **Practice interviews in your meetings log.** Interviews you have had now appear among your meetings on Home and Meetings, marked as not counted toward your hours. Your balance is unchanged.
- **Set tasks for a program's mentors.** From the new Set a mentor task button on a program, admins can set a task with a deadline for every mentor in it or the ones they pick, and attach the students it is about. Mentors see it on Home and tick it Done.
- **Fix feedback after you send it.** You can edit practice-interview feedback you sent until 30 minutes after the interview ends.
- **Mark a partner absent.** If your practice-interview partner never joins, tap Mark absent once it has started. The interview closes without notes and they are told.
- **The 0% step reads "Incomplete".** On a task's progress row, the first step now says Incomplete instead of 0%.
- **Mentors can read a student's practice interviews.** A mentor who has worked with a student sees their interviews on the student's page, with their answers, notes and the feedback sent each way.

### Fixed
- **"Log a session" is always blue.** The button was grey on a program's page and on a student's page in the admin view, and blue everywhere else. It is now blue wherever it appears.
- **No more blank names.** Somebody whose Google account sent an empty name showed as nothing at all. They now show by email until a name is set.
- **Full names for the team.** Mentors and admins who showed by first name only now show their full name.
- **Roomier tabs above the admin Programs table.** The All / Over capacity tabs no longer crowd the card edge and the table heading.

## 2026-10-07

### New
- **A student can also be a mentor.** Somebody who studies here and mentors here gets a Student / Mentor switch in their menu, like a mentoring admin.
- **"Report a mentor" moves under your picture.** On a student's Home the button sits in the top-right corner at half its old width, slimmer, and red.

### Fixed
- **Remove a student once their sessions are voided.** A student whose only sessions were voided could not be removed. They can now, and their email is free to register again.
- **An email change takes over an empty account.** If the new address already has one, it is removed with the change instead of refusing.
- **A mentor's program table counts every meeting.** Hours drawn from a student's hour bank, and time given out of plan, now show under their program (the latter in a new Extra column), so a program no longer reads "0 min" while the total above it counts those hours.

## 2026-10-06

### New
- **"Needs you" starts closed.** On a mentor's Home the list is folded to its title and count; tap it to open the rows. The full list in Notifications is unchanged.
- **Programs can log hours as classes.** Turn on "Logs hours as classes" in a program's settings (off by default) and the roster becomes groups: add a group by name with no email, and logging an hour is logging it for that group.
- **Less text to read.** Admin and mentor pages drop lines that repeated a heading or a figure beside them, and time columns say Total instead of Granted.
- **A big "Report a mentor" button.** It sits right under the greeting on a student's Home, replacing the Feedback tab, and opens a shorter report form.
- **Meetings you can see, and page through.** A student's Home shows the three latest meetings with page numbers under them, and the Meetings page is numbered too.
- **Home shows what needs you.** Admin and mentor Homes list the top issues inline, like hours that expired or are about to, and a mentor's students are sorted so whoever is running out of time comes first.
- **Faster session logging.** Pick 30, 45, 60 or 90 minutes in one tap, the fields come in the order you fill them, and on a phone the Log button stays in reach above the tab bar.
- **Log from search.** Press ⌘K, find a student, and log a session with them straight away. The best match now comes first.
- **A clearer student Home.** It opens with the hours you have left and when to use them, lists each task once, and a new student sees how freshlog works instead of empty boxes.
- **Every program has its own colour.** Programs are easy to tell apart, keep the same colour on every page and chart, and stay readable in dark mode.
- **One place to add things.** New program, Register a mentor and Add students are the same button at the top right of their page, and open a form right under the title.
- **Neater phone lists.** Students, programs and a mentor's caseload are one or two lines each on a phone instead of tall stacked cards.
- **Redesigned tables.** Every table has clear column headings, more room per row and larger faces. Programs show as coloured tags, and each balance has a bar showing how much has been used.
- **Sessions are easier to scan.** Each session shows its day as a small calendar tile, the student's face, the mentor and the program, and the minutes on the right. The list is split by month.
- **See how long since the last session.** On the student lists, under the date of a student's last session, you can see how long ago it was, such as "5 days ago".
- **See program load at a glance.** Programs and admin Home show a "Time used" bar for each program: used time in orange, expired time in red.
- **A roomier program page.** A program's mentors sit in a strip above the roster, so the student list gets the full page width and names are no longer cut short.
- **Calmer settings and lists.** Program settings say whether each option is On or Off in a word, a student's time menu folds the rarely used "Move time" form until you ask for it, older What's new days fold away, and Notifications say a repeated line once.
- **Comfortable is now the default density.** On a laptop, text is full size and table rows have more room. The previous size is still in Settings as Standard, beside Compact.

### Fixed
- **Register a mentor who already tried to sign in.** An email that said "already has an account" but could not be found was an empty sign-up. Registering now replaces it, and says plainly when the address is a real student or mentor.
- **Quieter student pages.** Repeated names, "Booked" and "You confirmed this" labels, explainer sentences, empty-state paragraphs and settings descriptions are gone, so each student page says each thing once.
- **Long links no longer stretch the page.** Pasting a long link or an unbroken string into a note, task or bug report used to make the whole page scroll sideways. It now wraps inside the box.
- **Tables never lose their columns.** When a table is too wide for its space — a narrow laptop, larger text, a very long program name — it now scrolls sideways instead of silently cutting off the last columns. A program tag shortens a long name, and the mentor Home caseload fits a 1,024-pixel laptop.
- **Phones and larger text.** A mentor's page header no longer runs off a phone screen when their program names are long, and the sessions list and the headline figures re-arrange themselves when text is enlarged instead of being cut off.
- **No more dead links for unplaced students.** A student with no program shows as "not in a program" instead of linking to a missing page.
- **The Log a session form tidies up after itself.** A message such as "Choose a student" disappears as soon as you fix the field, a session can be at most 24 hours, and pasting a decimal like 1.5 into Minutes is refused instead of turning into 15.
- **Every page has its own title.** Tabs and history tell pages apart, and moving to a new page announces it and moves keyboard focus to it.
- **Hours bars tell the truth about expired time.** Time that lapsed unused is red on the bar instead of looking used, and empty values are readable.
- **Confirm-session cards say which meeting.** Each card now shows the day and length of the meeting.
- **Easier to tap on a phone.** Names, chips and links in rows, the Light/Dark and notification switches, and the common session lengths now have finger-sized tap areas.
- **Clearer details.** Empty rating stars are visible, a Home alert no longer shows twice, "Add students" explains that you pick a program first, a disabled Log session button says what is missing, and search links no longer carry empty filters.
- **Duplicate program names are caught.** Two names that differ only in capital letters are refused.
- **A mentor's program totals add up.** On a mentor's page, the per-program table now counts every session ever logged, like its Total and Remaining, so the row adds up whatever period you pick above it. Total comes last.
- **Figures add up.** Completed, missed, remaining and expired now add up to the time granted, the same total reads the same on every page, and analytics percentages match the period you picked.
- **Expired hours look expired.** Time lost on its use-by date shows in red on the hours ring and bars, instead of as used or still available.
- **Ratings stay anonymous.** Mentors no longer see the rating or comment a student left on a session, as the Feedback page promises. A dispute's wording still reaches them.
- **Counts match what you see.** "Things to check", the bell and notifications count the rows they actually show.
- **Forms explain what's missing.** Every required field says what it needs right under it, in one style, instead of mixing browser pop-ups with red text.
- **Easier to read and tap.** Text sizes, focus rings, contrast in dark mode, and tap targets on phones are consistent across the app, and menus open smoothly instead of popping.
- **Search mentors in Analytics.** The mentor list on the Analytics page has a search box. Type part of a name to find them, wherever they rank.
- **Every program has its own colour in Analytics.** Charts, legends and program cards give each program a distinct colour instead of shades of blue and grey.
- **Changes save as you make them.** Editing a mentor's programs, a student's hours and use-by date, or an agenda item no longer needs Save changes or Done. The edit saves when you finish it, and a tick shows it did.
- **What's new is an icon.** On a laptop, What's new and the bell are now two small icons in the top right corner, level with the page title, instead of a row of their own above it.

## 2026-10-05

### New
- **Headline figures stand out.** Home, a program's page and a mentor's Home open with one panel: hours remaining large on a warm background, with the other figures beside it.
- **Theme and Density show their choices.** Settings now offers Light or Dark, and Compact, Default or Comfortable, side by side with the current one highlighted, instead of one button that cycles.
- **Sign-in looks the part.** A soft glow behind the card, and a white Continue with Google button.
- **What's new looks the part.** A summary of the past week, a timeline of days, a card for each change, and a soft glow behind every page. Blue buttons are lit from above and the current page is marked in the sidebar.
- **What's new is quicker to skim.** Every update now has a short headline, with a line of detail under it.
- **What's new beside the bell.** On a laptop it sits in the top right corner, with a blue dot when something is unread, instead of inside the account menu.
- **Calmer, cleaner tables.** Column headings sit quietly above the rows instead of on a shaded band, rows are no longer striped, and the figure that matters most (like hours remaining) is in bold rather than a tinted column. Rows are a little tighter and section headings quieter.
- **Sessions read one per line.** On a laptop each session is a single line — date, who, what it was about, and the time — so a long log scans down its dates and minutes. The edit button appears when you point at a row.

### Fixed
- **What's new and the bell no longer cover the page.** On a laptop they sit at the top of the page, above the title, instead of floating over tables and buttons as you scroll.
- **Mentors can move to their sign-in address.** A mentor who signed in with a different Google account than the one on file was made a student there, and changing their email to it said "already has an account". The change now removes that empty student sign-up and the mentor gets their own pages back.
- **Names are no longer clipped.** Letters with tails, like y, p and g, were cut off in the compact name chips on session rows and tables.
- **Small text is easier to read.** Emails, captions and column headings are a little larger, initials in small avatars are bigger, and the sort arrows are clean chevrons.
- **Row menus no longer take a line on a phone.** On a phone, the ⋮ menu on agenda items, time by mentor and the mentor's student list sits in the row's corner instead of under it.
- **A mentor's student list fits a tablet.** Names are no longer cut to a few letters: the last-session column steps aside on a tablet, and shows again on a laptop.
- **Analytics reads at a glance.** The hours card shows in-plan against extra as a bar, the monthly chart has wider bars with their values printed above them, and empty months show a small mark instead of nothing.
- **Table headings stay on one line.** A heading like "Lowest recent" no longer wraps and pushes its column out of line.
- **Rows light up under the pointer.** The row you point at takes a soft blue tint, and empty cards show a small icon.
- **Sign out is always in reach.** The account menu opens as tall as it needs to, so Theme, Density and Sign out are no longer hidden below a scroll, and the session edit panel shows its Done, Void and Delete buttons.
- **Mentors list reads properly.** Program names and the booking-link badge no longer squash into tall columns.
- **Students fit a tablet.** The student lists no longer scroll sideways at tablet width, and a student's page keeps "Allocate time" in view.
- **Exchange visits read the same everywhere.** A student's own programs come first, then the program they are visiting, with "on exchange" beside it.
- **Easier to read in daylight.** Amber figures, grey labels and avatar initials now have enough contrast on the light theme, and links in the changelog are underlined.
- **Add students has room for the email.** The email box is the widest, and on a phone the boxes use the full width.
- **Cleaner phone screens.** A long back link no longer runs into the page title, small buttons are easier to tap, and rows of filter chips show that they scroll.
- **Dates look the same everywhere.** Filters, session edits and task deadlines use the same date picker as Log a session.
- **Student meetings add up.** Home and the Meetings page count the same meetings, rated sessions offer "Change rating", and a voided session reads the same to everyone.
- **Tidier Analytics, Notifications and Settings.** Program totals stay on one line, headings and arrows line up, and the Theme and Density controls look usable.
- **Adding a student who already signed in.** A student who signed in with Google before an admin added them can now be added by their email: their account becomes a student in the program, with its standard hours. Addresses that belong to a mentor or admin are still refused, and the message now says which.
- **Bell count clear of the bell.** A number like "99+" now hangs off the bell's corner so the bell stays visible.
- **Overdrawn time says "over".** A program that has spent more than it was given now reads "65+ hours over" instead of "-65+ hours", on Home, Programs and a program's page.
- **Home says what needs you.** "10 items need your attention" with a "Review in notifications" link, and the "Updated" stamp now carries the date and offset — "October 5, 15:10 Tashkent (UTC+5)" — with the exact time on hover.
- **Programs on Home can be sorted.** Click Program, Students, Mentors or Remaining to order the table — Remaining opens with the program furthest over — "Over capacity" programs are tagged and can be shown on their own, and "All programs" opens the full list.
- **The bell shows what its count is made of.** Open it to see unread notices by kind, deadlines first, each opening its own feed; a screen reader hears how many of the unread are deadlines.
- **Overdrawn students are marked in pickers.** When logging a session or allocating time, students with no time, overdrawn time or expired hours sit under their own headings, and a warning stays under the picker once one is chosen. Logging time that would add to an overdraw asks you to confirm it, unless it is marked Extra.
- **The role switch says where it goes.** "Switch to Mentor" and "Viewing as Admin" replace a bare "Mentor" button.
- **Editing a session says whose it is.** The panel opens with the student, mentor, date and length, says that changes save as you make them, and has a Done button — Void and Delete are set apart under "If it should not count".
- **Edit panels keep keyboard focus.** Opening an agenda item's edit form moves focus into it, and Tab no longer leaves the page for the browser's toolbar.
- **New program, cohort and level fields have labels.** The field names stay on screen once you start typing, and are read out by screen readers.
- **Session corrections read clearly.** A correction says what moved — "moved to September 24, 2026 (was October 24, 2026)" — with years on both dates, and a session can no longer be logged or corrected to a day that has not happened yet.
- **An empty session search says what it searched.** "No sessions match "…"" with links to clear the search, reset the filters or log a session.

## 2026-10-04

### Fixed
- **Sign-in email can be corrected.** An address a student signed in with by mistake can now be switched to; the empty account it held is removed. An address held by a real account is still refused.
- **Filters apply.** Program, kind, status and date dropdowns on Students, Mentors, Sessions and Feedback now work, with an Apply button beside them.
- **Time-left filters match the bell.** "Expiring" and "expired" no longer include fully spent grants, and inside a program they judge that program's hours.
- **Tables fit the page.** Long names and emails shorten instead of pushing contact links and figures out of view, and "45 min" stays on one line.
- **More room on a laptop.** A program's mentor list sits under the student roster, so every roster column fits.
- **Long titles wrap on a phone.** A long name or email as a page title no longer pushes the page sideways.
- **Top bar clear of Home.** On a laptop, longer student names no longer cover the Home link.
- **Notices count the right program.** "8 students have no time allocated" counts only the program it names, and its link opens exactly those students.
- **Notifications agree.** "All caught up" no longer sits above things still to check, and a student's "Things to check" count matches the bell.
- **Pages load without JavaScript.** They no longer stop at the loading skeleton; only the dropdown filters need scripts.
- **Small layout and wording fixes.** Long task titles, status labels on tablet rosters, program dots on a phone and the void-session note no longer get squeezed or cut off, plus a missing space, "1 mentor matches these filters" and initials without brackets.

## 2026-10-03

### New
- **Research has three levels.** Emerging, Advanced and Frontiers each have their own starting grant (2h, 15h, 20h) and their own intake cohorts. Enrolling a student asks for program, then level, then cohort.
- **Mentors can teach one level or all.** Pair a Research mentor program-wide, or narrow them to a level or a cohort.
- **Promotions don't move hours.** Moving a student between levels or intakes is a label change; the balance belongs to the program.
- **Level tabs on a program's page.** Each tab shows the level's student count and what it grants on joining.
- **Research Institute.** For people who work only in Research, the institute's name tops every page. Admins get the three levels in the sidebar, a home page split by level, and Analytics with a "Whole school" button. Nobody gains or loses access.
- **Any program can be an institute.** Platform admins can turn it on or off in the program's settings.

### Fixed
- **Admin and Mentor switch.** A mentor given admin access to a program can now reach the admin pages.
- **Hour banks keep their size.** Including past hours no longer shrinks the bank; unused time folds in instead of being taken out twice.
- **Analytics cards read right.** A program now shows how much of its granted time was delivered — "55% of the 8h granted".

## 2026-10-02

### New
- **Report a bug.** Use the account menu, with a screenshot if it helps. Bug reports shows where each report stands and what has been fixed.
- **Custom dates on a mentor.** Read their completed hours over any start and end date, not just 30 or 90 days.
- **What's new page.** Find it in the account menu; a blue dot on your account button says when there is something unread.

### Fixed
- **Long session notes.** "Log a session" stays reachable, and a reload keeps the note.

## 2026-10-01

### New
- **Logging after a deadline.** Allowed again, with a note that the deadline has passed.
- **Same corrections on the pinned row.** The hour bank's pinned row offers what a mentor's row does.

### Fixed
- **Ratings stay private.** Only admins of the student's own programs see who left one.

## 2026-09-30

### New
- **Hours follow a program move.** A student's unused hours carry across, so nothing they were owed is lost.
- **Exchanges lock the student.** A visiting student can't be moved or unenrolled until the exchange ends; returning them is the way out.

### Fixed
- **Voided sessions free the hours.** Removing a mentor's hours is no longer blocked by voided sessions.
- **Grant menu reachable.** For a student with time in two programs, it is no longer cut off, and each program's name sits under the mentor.

## 2026-09-29

### New
- **Standard hours.** A program can give every new student a set number of hours to use within a set number of days, with no one granting them by hand.
- **Access to one program.** Admins and mentors can be limited to a single program, with a screen to manage who has it.
- **Stay in the program.** Opening a student from a program keeps you there, with a path back.

### Fixed
- **Task status labels line up** with the text beside them.
