# freshlog user guides

Simple, one-role-per-file instruction sheets (PDF):

- **student-guide.pdf** — signing in, reading your hours, deadlines, booking, no-shows.
- **mentor-guide.pdf** — signing in, booking links, logging sessions against a task (incl. no-shows), deadlines, corrections.
- **admin-guide.pdf** — dashboard, a program's three tabs, allocating hours for a task (deadlines + Master's amount paid), tasks, mentors, program settings, the admin/mentor toggle, reading the stats.
- **interview-guide.pdf** — for students: offering a time, booking a classmate, running a practice interview, giving feedback, who sees what.

## Regenerating

The PDFs are built from `generate-guides.cjs` with [pdfkit](https://pdfkit.org/) (pure JS, no browser). Edit the content in that file, then:

```bash
# in a scratch dir (pdfkit is not a project dependency)
npm init -y && npm install pdfkit
NODE_PATH=$PWD/node_modules node /path/to/repo/docs/guides/generate-guides.cjs /path/to/repo/docs/guides
# add a guide name (student, mentor, admin, interviews) to rebuild just that one
```

Keep the wording in step with the app when behaviour changes.
