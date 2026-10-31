# Primary School Management System — v0.6.7 Online Deployment Preparation Build

## Academic report card enhancements
- Editable class teacher comments and headteacher remarks saved per learner, academic year, and term.
- Attendance summary on report cards when the user selects the actual date range for that term.
- Attendance counts show present, absent, late, excused and total recorded attendance entries.
- Report card print layout includes marks across Beginning of Term, Mid-Term and End of Term, grades when the school's grading scale is configured, comments, attendance and signature lines.

## Important
This is a development build and has not been fully live-tested. Attendance is included only if both date fields are supplied; choose the school's actual term dates rather than relying on assumed calendar dates. Configure the school's approved grading scale before issuing official reports. Back up the database before migrating or using real records.

## Run locally
1. Install a supported recent Node.js version.
2. In this folder, run `npm install`.
3. Copy `.env.example` to `.env` and set a random `JWT_SECRET` of at least 24 characters and a strong initial admin password if required by the setup instructions.
4. Run `npm run setup-admin` if creating the first administrator, then `npm start`.
5. Open the local address shown in the terminal.

Do not expose the application to the public internet until deployment security, backups, access permissions, and end-to-end tests have been reviewed.


## Version 0.6.5 — Performance-based report comment assistant

This development version adds a report-comment assistant to the Academic Records report card panel. It generates editable class-teacher and headteacher comment suggestions from saved subject averages, stronger and weaker subjects, beginning/mid/end-of-term mark trends, and attendance counts when an attendance date range is selected. Teachers can select an encouraging, formal, or concise style, review and edit suggestions, then save them using the existing report-notes workflow.

The assistant does not invent marks or grade bands, and it produces a cautious reminder when no subject marks are available. Generated comments are suggestions and should be reviewed by school staff before use. This is still a development build; live end-to-end testing and deployment are not complete.


## Version 0.6.6 — Cornhill branding and comment library

- Sets the default school name to **CORNHILL NURSERY AND PRIMARY SCHOOL** on the login screen, system branding, and printed academic report cards. The `SCHOOL_NAME` environment variable can still override this.
- Adds an editable-in-place comment template library for positive performance, improvement support, effort and participation, conduct and cooperation, attendance and punctuality, and parent/guardian partnership. Templates are inserted into the existing comment fields and can be edited before saving.
- Keeps performance-based comment generation from version 0.6.5. Staff must review all suggestions and ensure they accurately describe the learner.

This is a development build. Syntax and package checks do not replace full live testing, database backup/restore checks, security review, or deployment testing.


## Online hosting notes (v0.6.6 deployment preparation)

The app listens on the `PORT` environment variable and can use a persistent SQLite location via `DB_PATH`. For a hosting provider that supports persistent disks, mount a disk (for example at `/var/data`) and set `DB_PATH=/var/data/school.sqlite`. Do not use an ephemeral filesystem for real school records: data may be lost on redeploy/restart.

Required environment variables: `JWT_SECRET` (unique random value, at least 24 characters), `SCHOOL_NAME=CORNHILL NURSERY AND PRIMARY SCHOOL`, `DB_PATH` (persistent disk path), `ADMIN_USERNAME`, and `ADMIN_PASSWORD` (at least 12 characters). Keep secrets private. Run `npm run setup-admin` exactly once after environment variables are set and before staff sign in. If an admin account already exists, the setup command will stop rather than overwrite it.

Before real use, configure persistent backups, test restore, confirm TLS/HTTPS, review role permissions, and run end-to-end tests. The app is not certified production-ready. Hosting charges and persistent disk availability depend on the provider and plan.


## Version 0.6.7 — Online deployment preparation

- Adds optional `DB_PATH` configuration so SQLite can live on a hosting provider persistent disk.
- Adds initial admin environment-variable instructions for hosted setup.
- Hosting, security review, and end-to-end testing still need to be completed before real school use.
