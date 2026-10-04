# Changelog

What we have added and fixed, newest first. Each commit that changes what you see or can do adds a line here.

## 2026-10-04

### Fixed
- A student's sign-in email can now be changed to an address they already signed in with by mistake. The empty account that address held — never approved, nothing in it — is removed as part of the change, instead of blocking it with "already has an account". An address held by a real account still refuses.
- Student, mentor and feedback tables fit their page again. Long names and emails shorten instead of pushing the last columns — contact links, figures — out of view, and figures such as "45 min" or "15+ hours" no longer break across two lines.
- On a laptop, a program's page puts its mentor list under the student roster instead of beside it, so the roster has room for every column.
- A long name or an email address used as a page title now wraps on a phone instead of pushing the whole page sideways.
- On a laptop, the top bar no longer draws the freshlog name over the Home link for students with longer names.
- A notice such as "8 students have no time allocated" now counts only the program it names, and its link opens exactly those students.
- Notifications no longer say "All caught up" above a list of things still to check.
- A long task title no longer squeezes into a narrow column on the student's home page.
- Small fixes: a missing space in "… hasn't offered any times yet", "1 mentor matches these filters", and initials no longer pick up brackets ("MS", not "M(").

## 2026-10-03

### New
- The three research programs become one. The Research Program now holds three levels — Emerging, Advanced and Frontiers — each with its own starting grant (2h, 15h and 20h), and each level can hold intake cohorts of its own, so two levels may both have a "Fall 2026". Enrolling or moving a student asks for program, then level, then cohort. Mentors can still be paired program-wide — one Research mentor may teach in every level — or narrowed to a level or a cohort, and each program's roster gains a level filter.
- Moving a student between levels or intakes of the same program no longer touches their hours: the balance belongs to the program, so a promotion to Advanced is a label change rather than a transfer.
- Research is now the Research Institute for the people who work only there. Its admins, the mentors paired only in Research and the students who study only in Research see the institute's name at the top of every page. Admins get Emerging, Advanced and Frontiers in the sidebar, a home page that splits students and remaining hours by level, and Analytics that opens on the institute with a "Whole school" button. Nobody gains or loses access, and everyone else still sees Research as one program among the others.
- A leveled program's page now has a tab for each level, with that level's student count and a line saying what the level grants on joining. The tabs replace the level filter.
- Platform admins can show any program as its own institute, or turn that off, from the program's settings.

### Fixed
- A mentor who is given admin access to a program now gets the Admin and Mentor switch, so they can reach the admin pages instead of being stuck in the mentor view.
- Creating an hour bank and choosing to include past hours no longer shrinks the bank: the number you enter is the bank's size, and the student's unused time with mentors folds into it instead of being taken out twice.
- A program card on Analytics now says how much of the program's granted time has been delivered — "55% of the 8h granted" — instead of that program's share of every hour the school logged, which read as if a small program had barely started.

## 2026-10-02

### Fixed
- A long session note no longer makes "Log a session" unreachable. Drafts that grew past what a web address can carry now restore from the browser instead, so reloading keeps the note rather than failing to open the page at all.

### New
- You can now report a bug from the account menu, with a screenshot if it helps. Bug reports shows what you have reported and where each one stands, and a list of what has been fixed.
- On a mentor's page you can now read their completed hours over any dates you choose, not just 30 or 90 days. Pick Custom, enter a start and end date, and the figure says exactly which days it covers.
- There is now a "What's new" page in the account menu listing what we have added and fixed. A blue dot on your account button tells you when there is something you have not read.

## 2026-10-01

### New
- Logging time after a grant's deadline is allowed again, with a note that the deadline has passed. A deadline is a use-by date, not a wall.
- The pinned row in the hour bank now offers the same corrections as a mentor's row.

### Fixed
- The name of whoever left a rating is shown only to admins of that student's own programs, and to nobody else.

## 2026-09-30

### New
- Moving a student to another program now carries their unused hours across, so nothing they were owed is lost in the move.
- A student who is visiting another program on an exchange can no longer be moved or unenrolled until the exchange ends. Returning them is the way out.

### Fixed
- Voiding a session now really lets you remove that mentor's hours. Before, voided sessions still counted and the removal stayed blocked.
- The grant menu on a student who has time in two programs was cut off the edge of the screen. It is reachable again, and each program's name now sits under the mentor.

## 2026-09-29

### New
- A program can set standard hours: every new student who joins gets a set number of hours to use within a set number of days, with no one granting them by hand.
- Program admins and mentors can be given access to just one program, with a screen for managing who has it.
- Opening a student from a program keeps you in that program, with a path back.

### Fixed
- The status labels on a student's task rows are lined up with the text beside them.
