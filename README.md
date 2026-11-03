# CORNHILL NURSERY AND PRIMARY SCHOOL Management System

## PostgreSQL migration branch — v0.6.8 preparation

This branch is being prepared for online use with Supabase PostgreSQL. The `main` branch is not changed by this work.

## Database setup

1. Create a Supabase project and open its SQL Editor.
2. Run the complete contents of `supabase/schema.sql` once. The schema creates the required tables but does not import records from an earlier SQLite database.
3. In the hosting provider, set `DATABASE_URL` to the PostgreSQL connection string from Supabase. Use the pooler connection string for serverless/shared hosting where appropriate. Keep this value private.
4. Set `JWT_SECRET` to a unique random secret of at least 24 characters.
5. Set `SCHOOL_NAME=CORNHILL NURSERY AND PRIMARY SCHOOL`.
6. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD`; the password must be at least 12 characters.
7. After deployment dependencies are installed, run `npm run setup-admin` once to create the first administrator. Do not run it again for an existing username.
8. Start the web service with `npm start`. The service listens on the hosting provider's `PORT`.

Optional: set `PGPOOL_MAX` to tune the PostgreSQL connection pool. TLS certificate verification is disabled for the PostgreSQL connection by default to support common managed Supabase connection endpoints; use a trusted connection endpoint and keep HTTPS enabled for the web app.

## Important data warning

The PostgreSQL schema is separate from the old SQLite database. Running `supabase/schema.sql` does not copy students, staff, payments, marks, users, or other records from SQLite. Do not delete the old database or start entering official live records until the school has decided whether existing records must be migrated and a verified backup has been made.

## Current application coverage

- Student register with class, boarding, meal, bursary, guardian and photo fields.
- Staff register and three-month term payroll tracking.
- Fee payments and receipt references.
- Attendance, expenses, inventory and stock movements.
- Academic subjects, grade bands, marks for Beginning of Term, Mid-Term and End of Term, ranking, analysis, report cards and report comments.
- Role-based staff accounts.

## Testing and production readiness

This is a migration/development branch and has not yet passed full end-to-end testing against the school's live Supabase project or a hosted deployment. Before real school use, test administrator login, each role and permission, student/staff entry, fee receipts, payroll, stock movements, attendance, marks, report cards, concurrent staff access, database backups and restore. Confirm the hosting provider's free-plan limits and data-retention policy. Do not treat a successful build as proof that the system is production-ready.

## Local development

1. Install a supported recent Node.js version.
2. Run `npm install`.
3. Configure the environment variables above in a private `.env` file (never commit `.env`).
4. Run `npm run setup-admin` once if the administrator does not already exist.
5. Run `npm start` and open the local address shown in the terminal.

## Desktop note

The web service is started with `npm start`. The package currently retains legacy Electron script entries; confirm the desktop entry point exists and is tested before relying on those scripts.