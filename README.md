# 7A6 Study Bot — Render + PostgreSQL

This version stores users, schedules, announcements, tasks, XP, sessions, and progress in PostgreSQL instead of `data/db.json`.

## Render deploy

The included `render.yaml` creates:
- a Node web service
- a Render PostgreSQL database
- `DATABASE_URL` wired automatically to the web service

On the first Blueprint sync, Render will prompt for the values marked `sync: false`:
- `OPENAI_API_KEY`
- `ADMIN_USER`
- `ADMIN_PASSWORD`

Do not commit real API keys or passwords to GitHub.

## Important free-tier note

Render currently offers Free Postgres, but a Free Postgres database expires 30 days after creation and has no backups. For a real long-term public app, upgrade the database before the free period ends. See Render's current Free plan documentation for details.

## Existing `db.json`

If a legacy `data/db.json` is present when the server starts, the app performs a one-time import into PostgreSQL. The normal deployed version no longer writes to `data/db.json`.
