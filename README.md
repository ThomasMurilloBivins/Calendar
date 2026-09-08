# Planner

A single-user, mobile-first planning app. Runs free: Render free web service +
Neon free Postgres. No API keys, no paid services, nothing to buy.

## How it stays fast on a sleeping free tier

Render's free tier sleeps after ~15 minutes and takes 30–60s to wake. So the app
is **local-first**: the browser (IndexedDB) is the source of truth for everything
you see and type, and a service worker caches the app itself. Capture works
instantly whether the server is asleep, waking, or unreachable. The server is
only a backup that your phone and laptop merge through.

Because two devices can both edit while one is offline, sync merges **per
record** (union by id, newer `updatedAt` wins) rather than overwriting whole
snapshots — so a capture on your phone can't be erased by a later save from your
laptop.

## Run locally

```sh
npm install
npm start          # http://localhost:3000
```

With no env vars set it runs local-only: fully usable, just not backed up.

## Deploy

**1. Database — Neon** (free, no card, does not expire)

Sign up at neon.tech, create a project, copy the connection string from
**Connect**. Do *not* use Render's own free Postgres — those expire after ~30
days and you would lose a semester of planning.

**2. Web service — Render** (free)

New → Web Service → connect this repo.

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build command | `npm install` |
| Start command | `npm start` |
| Instance type | Free |

Environment variables:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | the Neon connection string |
| `APP_PASSCODE` | any passcode you'll remember — it's the only thing guarding a public URL |

**3. Install it on your phone**

Open the Render URL in Safari (iPhone) or Chrome (Android), enter the passcode,
then Share → **Add to Home Screen**. Installing is what makes it open instantly
offline, and it stops iOS evicting the stored data. On your laptop, open the same
URL and enter the same passcode — the two merge automatically.

## Design notes

The reasoning behind the features is documented in `CLAUDE.md` and is not
decoration: no streaks anywhere, nothing resets on a missed day, the progress bar
starts partly filled, days are capped at three tasks, and dropping a task is a
first-class one-tap action.
