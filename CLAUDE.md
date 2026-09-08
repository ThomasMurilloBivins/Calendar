# Project: Personal Planner (single-user)

## What this is
A mobile-first personal planning web app for one user (me), replacing a paper
planner. Research-backed; the reasoning behind each feature matters, not just
the feature.

## Hard constraints
- Hosts on Render free tier — sleeps after ~15 min idle. No reliable background
  jobs. NO push notifications.
- No paid API key. No server-side LLM calls. "AI" steps happen by pasting text
  in/out manually.
- Keep the stack simple and cheap. Data must survive sleep/wake.

## Design rules (apply everywhere)
- Capture is instant: no dropdowns or required fields at capture time.
- Separate capturing from organizing.
- Design for setbacks: missing a day/task never punishes or resets progress.
- Nudge toward moderate goals; discourage overloading a day.
- KEEP IT MINIMAL. No over-engineering, no unrequested abstractions or files.
  Ask before adding complexity.

## Do NOT build
- Any budgeting or "money left to spend" feature.
- Streaks. Anywhere. Habits are rolling 30-day percentages only.

## Workflow
- Plan mode before edits; wait for my approval.
- Work in milestones; commit after each working milestone.
- Prefer the simplest solution that passes.

---

## Stack (decided, don't re-litigate)
Vanilla JS ES modules, **no build step**, no framework. Node 22 + Express serves
`public/` and two snapshot endpoints. Neon free Postgres (NOT Render's free
Postgres — it expires). Everything is free tier, no card, no API keys.

**Local-first**: IndexedDB holds the whole app state as one JSON document and is
the source of truth for the UI. Render's cold start would otherwise take 30–60s
and destroy instant capture. The server is only a backup/sync target.

**Sync across phone + laptop**: per-record merge, not last-write-wins. Every
record has `updatedAt`; merge = union by `id`, newer wins. `habitLogs`/`hourLogs`
are append-only and just union. Server holds an integer `version`; a stale PUT
gets 409 + current state, client merges and retries.

**No background jobs exist.** Every derived value (overdue, "this week", rolling
30-day %, progress) must be a pure function of `now`, computed at render time.

## Files
```
server.js                 static + passcode auth + snapshot GET/PUT
public/app.js             state, IndexedDB, sync, router, capture bar, toast
public/screens/*.js       today, inbox (incl. triage), week, projects
public/app.css            one stylesheet, mobile-first + one 900px block
public/sw.js              cache-first shell, network-only /api
```

## Env vars
- `DATABASE_URL` — Neon connection string. Unset = local-only mode (still works).
- `APP_PASSCODE` — single shared passcode. Unset = no auth (local dev only).
