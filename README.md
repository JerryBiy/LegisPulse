# LegisPulse

LegisPulse tracks Georgia legislative bills and provides AI-generated bill analysis. Built for Georgia legislative staff and advocates to monitor bill activity, track legislation of interest, share bills with teammates, and get instant AI summaries of bill changes.

## Current Capabilities

- **User accounts** — register, log in, and log out with email/password (powered by Supabase Auth)
- **Per-user data** — tracked bills, email lists, and notifications are stored in a cloud database, tied to your account
- **Team collaboration** — create a team, invite colleagues by email, share bills across the team
- **Team chat** — real-time messaging between team members with emoji, file/image attachments, drag-and-drop upload, and auto-expiry after 2½ weeks
- **LC number tracking (all bills)** — a background scraper keeps the LC (Legislative Counsel) number for every bill in the session up to date from legis.ga.gov, with change notifications
- **Comparison tab** — compare two bill versions/substitutes side-by-side with an AI-generated summary of additions, removals, and modifications, plus authoritative per-version LC numbers and chamber labels
- **Calendar** — session-scoped Georgia meetings with exact agenda bill lists
- **Committees** — browse official committees, members, all bills, and saved bills that are currently assigned
- **Twitter/X feed** — embedded legislative news feed
- **Account profile & settings** — display name, username, and avatar upload
- Store every available Georgia session from LegiScan via lightweight master lists
- Auto-refresh current sessions and reuse historical archives until LegiScan's dataset hash changes
- Show newest bills first (higher bill number first)
- Search by bill number/text with improved exact matching (e.g. `HB10` and `HB 10`)
- Track/untrack bills — persisted to your account across devices
- Add/remove bills to your team's shared list
- Open direct bill PDFs (uses LegiScan `getBillText` flow when available)
- Fetch and display sponsor lists (cards + details)
- Generate and regenerate AI summaries from bill text context (`summary` + `changes_analysis`)
- Instant tab navigation — data is cached in memory so switching pages does not reload from the server
- Scroll position and "load more" count are remembered when navigating away from Dashboard

## Legislative Session Boundary

The session selector is populated only from LegiScan's session list and defaults
to its newest valid session. The selected LegiScan `session_id` is a global
application boundary for bills, personal and team tracking, notes, LC history,
calendar records, meetings, transcripts, alerts, notifications, and tweets.
Same-numbered bills in different sessions are separate records.

Migration `034_legiscan_session_isolation.sql` first isolates ambiguous legacy
rows under `session_id = 0`; migration `035_remove_legacy_session_zero.sql`
then deletes those unassignable rows and requires a positive session ID for
all session-owned records. Tweet ingestion must also write `state`,
`session_id`, and session-qualified bill references.

LegiScan IDs and legis.ga.gov IDs are different namespaces. The browser matches
committee rosters and meetings through the official legis.ga.gov session
directory by exact year range and regular/special type. Optional `VITE_*`
mapping values can override that discovery. The server-side LC worker still
requires its explicit, separately verified ID pair.

Session syncs use database RPC upserts that update only provider-owned fields;
they do not delete the session or overwrite user summaries, analysis, tags, or
PDF links. Current sessions are refreshed automatically. Historical sessions
are stored once in the shared Supabase `legislative_bill_cache` and skipped
until LegiScan's `dataset_hash` reports an archive correction. New accounts
hydrate their user-owned bill rows from that database-local cache without a
LegiScan request. Automatic refreshes also skip committee, people, sponsor, and
history fan-out calls while preserving richer stored fields. Detail calls remain
change-aware and processed in bounded batches when explicitly requested.
Migration 037 promotes migration 036's per-user metadata and seeds the shared
archive from historical sessions already present in `bills`, so they do not
require another first-run LegiScan download.

## Team Feature

Each user belongs to exactly one team. The owner can invite other registered users by email.

### Flow

1. **Owner** goes to the **Team** tab → sees their team name, member list, and invite form
2. **Owner** invites a colleague by entering their email and clicking **Invite**
3. **Invited user** goes to the **Team** tab → sees a **"Team Invitation"** screen with Accept / Decline buttons
4. After accepting, the invited user sees the owner's team and all shared bills
5. Owner can remove any member using the trash icon
6. Members can leave the team via the **Leave Team** button

### Database tables

- `teams` — one row per team (`id`, `name`, `created_by`)
- `team_members` — join table (`team_id`, `user_id`, `email`, `role`, `status`)
- `team_bills` — shared bills (`team_id`, `bill_number`)
- `team_chat_messages` — chat messages (`team_id`, `user_id`, `message`, attachment columns, `created_at`)

### RPC functions (security definer — bypass RLS)

| Function                              | Purpose                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------- | --- | ------------------- | --------------------------------------------------------- |
| `my_team_ids()`                       | Returns team IDs the caller owns or is active in (used in RLS policies) |
| `get_my_pending_invites()`            | Returns pending invites for the caller's email                          |
| `accept_my_team_invites()`            | Accepts all pending invites for the caller                              |
| `decline_my_team_invite(invite_id)`   | Declines a specific pending invite                                      |
| `remove_team_member(member_id)`       | Owner removes a member from their team                                  |
| `leave_my_team(p_team_id)`            | Member leaves a team they joined                                        |     | `get_my_team_ids()` | Returns team IDs the caller belongs to (used by chat RLS) |
| `get_team_member_profiles(p_team_id)` | Returns profile info for all members of a team                          |
| `get_team_chat_messages(p_team_id)`   | Returns chat messages with sender info (security definer)               |
| `send_team_chat_message(...)`         | Inserts a chat message with optional attachment fields                  |
| `cleanup_old_chat_messages()`         | Deletes messages older than 2½ weeks (runs via pg_cron every 6 hours)   |

## Team Chat

Real-time chat embedded in the Team page. All operations use `SECURITY DEFINER` RPCs to avoid RLS recursion.

### Features

- **Real-time messaging** — uses Supabase Realtime (`postgres_changes`) for instant delivery
- **Emoji picker** — powered by `@emoji-mart/react`; click the smiley icon to browse and insert emoji
- **File & image attachments** — click the paperclip icon or drag-and-drop a file (max 10 MB) onto the chat card
- **Inline image preview** — image attachments render as thumbnails in the message bubble
- **File download** — non-image attachments show as a card with filename, size, and a download button
- **2-minute delete window** — you can only delete your own messages within 2 minutes of sending
- **Auto-expiry** — a `pg_cron` job runs every 6 hours and deletes messages older than 2½ weeks
- **Optimistic UI** — messages appear instantly while uploading/sending

### Storage

Attachments are uploaded to a Supabase Storage bucket named `team-chat-files`. Storage policies allow any authenticated user to upload, anyone to read, and only the uploader to delete their own files.

### Migrations

| File                            | Purpose                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `003_team_chat.sql`             | Base `team_chat_messages` table, RLS, Realtime, cleanup function, pg_cron job |
| `004_chat_rls_fix.sql`          | `get_my_team_ids()` helper, recreated RLS policies                            |
| `005_chat_messages_rpc.sql`     | `get_team_chat_messages` RPC                                                  |
| `006_chat_send_rpc.sql`         | `send_team_chat_message` RPC                                                  |
| `007_chat_all_functions.sql`    | Comprehensive file with all 5 chat functions                                  |
| `008_chat_attachments.sql`      | Attachment columns, storage bucket, updated RPCs                              |
| `009`–`015`                     | Team invites/switching, team codes, bill metadata, multi-team, join approval  |
| `016_calendar_events.sql`       | Calendar events table                                                         |
| `017_lc_number_tracking.sql`    | Per-user `bill_lc_tracking` table + `bills.lc_number` column                  |
| `018_lc_tracking_seen_at.sql`   | Change-acknowledgement (`change_seen` / `change_seen_at`) columns             |
| `019`–`021`                     | Account/profile settings, profile avatar storage, chat avatar support         |
| `022_shared_team_bills_rpc.sql` | RPC for shared team bill data                                                 |
| `023_ga_meetings_cache.sql`     | Cache table for legis.ga.gov committee meetings                               |
| `024_bill_lc_history.sql`       | Global, one-row-per-bill `bill_lc_history` table (LC source of truth)         |
| `026_lc_history_all_bills.sql`  | Adds `legislation_id` to `bill_lc_history` for all-bills tracking             |
| `034_legiscan_session_isolation.sql` | Session keys, safe sync/legacy RPCs, and scoped indexes                |
| `035_remove_legacy_session_zero.sql` | Purges ambiguous legacy rows and requires positive session IDs         |
| `036_bill_session_sync_state.sql` | Original per-user LegiScan session dataset-version metadata               |
| `037_shared_legislative_bill_archive.sql` | Promotes 036 to a shared archive for instant history       |

Run each migration in the Supabase **SQL Editor** in order.

## LC Number Tracking (all bills)

Every bill on legis.ga.gov carries an internal **LC (Legislative Counsel) number** for each drafted version/substitute (e.g. `LC 33 9902S/RCS`). LegisPulse keeps the current LC number for **all ~5,480 bills** in the session continuously up to date so cards and the Comparison tab can display and diff them.

### How it works

- The scraper lives in [`server/lcRecheck.js`](server/lcRecheck.js) and runs **server-side on the Node host** (`npm start` → `server.js`). It must run from a US cloud host (e.g. Render) because legis.ga.gov firewalls Supabase edge IPs and most non-US egress.
- It enumerates every bill via `POST /api/Legislation/Search`, then reads `GET /api/legislation/Detail/{id}` and extracts the newest LC number from the `versions[]` list.
- Results are written to the global `bill_lc_history` table (one row per state/session/bill, with `legislation_id` bridging back to legis.ga.gov). Changed LC numbers are mirrored into the matching session's per-user `bills.lc_number` column.
- Work is **incremental** — a bill is only re-fetched when it is new or its status date advanced — so steady-state runs are fast.

### Endpoint & scheduler (`server.js`)

| Route                            | Behavior                                                          |
| -------------------------------- | ----------------------------------------------------------------- |
| `POST /api/lc-recheck`           | Run a recheck (default `90000` ms budget), returns a JSON summary |
| `POST /api/lc-recheck?budget=0`  | Run unbounded (full backfill of every bill)                       |
| `POST /api/lc-recheck?budget=ms` | Run with a custom wall-clock budget in milliseconds               |

- Protected by an `x-recheck-secret` request header when `LC_RECHECK_SECRET` is set.
- A scheduler (`startLcRecheckScheduler`) runs an unbounded pass ~20 s after boot and then every `LC_RECHECK_INTERVAL_MS` (default 1 hour). Concurrent runs are serialised — a second call returns `{ skipped: true, reason: "already running" }`.
- Also proxies `POST /api/openstates-graphql` → `https://openstates.org/graphql`.

### `LcTracking` API (`src/api/apiClient.js`)

| Method                                  | Purpose                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `getAll()`                              | Merged LC map for the user's tracked + team bills (includes change-notification state)  |
| `getGlobalLcMap()`                      | Lightweight `{ bill_number → current_lc }` for **every** bill (used by the dashboard)   |
| `getLegislationId(billNumber)`          | Resolve the legis.ga.gov `legislation_id` for a bill (bridge to the version detail API) |
| `getUnseenCount()`                      | Count of unseen LC changes for the current user                                         |
| `markAllSeen()` / `markBillsSeen(nums)` | Acknowledge LC change notifications                                                     |
| `batchUpsert(entries)`                  | Write LC numbers to the global history + bump the user's `last_checked`                 |

## Comparison Tab

The **Comparison** page (`src/pages/Comparison.jsx`) compares bill versions and substitutes with an AI-generated summary. It has four modes: **Versions** (two versions of one bill), **Two Bills**, **Across Years**, and **By Topic**.

### Hybrid data sourcing

The authoritative version list (with exact LC numbers and chamber labels) comes from **legis.ga.gov**, while the actual bill **text** fed to the AI comes from **LegiScan** (which exposes clean full text). The two are matched by recency so each version shows its own LC number while the diff runs on reliable text.

- `src/services/legisGa.js` → `fetchBillVersionsGa(legislationId)` returns LC-bearing versions oldest-first as `{ versionNumber, name, lc, chamber, isCurrent }` (floor amendments without an LC are filtered out).
- `src/services/legiscan.js` comparison helpers:
  - `getGASessions()` — cached session list (newest first) for the year picker
  - `fetchGABillsLite(sessionId)` — lean master list for fast search (cached per session)
  - `searchGABills(query, sessionId, limit)` — scored search by bill number/title
  - `findBillInSession(billNumber, sessionId)` — cross-year bill lookup
  - `fetchBillTextVersionsForAI(id, count, maxLen)` — extracted text for the N newest versions
  - `fetchNewestBillText(id)` — newest usable text body for a bill
- The AI summary is produced by `api.integrations.Core.InvokeLLM` and returns `{ chamber, chamber_note, added[], removed[], modified[], summary }`.

## Tech Stack

- React 18 + Vite
- Tailwind CSS + Radix UI (shadcn/ui components)
- **Supabase** — PostgreSQL database + Row Level Security + Auth + Realtime + Storage
- **@tanstack/react-query** — client-side data caching (5-minute stale time, shared cache keys)
- **@emoji-mart/react** — emoji picker for team chat
- **Node HTTP server** (`server.js`) — serves the static build, proxies OpenStates GraphQL, and hosts the LC-recheck scraper/scheduler (`server/lcRecheck.js`)
- **LegiScan API** — bill master lists, sponsors, and version text
- **legis.ga.gov API** — authoritative LC numbers, versions, committees, and meeting calendar
- `src/api/apiClient.js` — unified data layer over Supabase + OpenAI

## Environment Variables

Create a local `.env` file (gitignored):

```env
VITE_LEGISCAN_API_KEY=your_legiscan_key
VITE_OPENAI_API_KEY=your_openai_key
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# Optional
VITE_OPENAI_MODEL=gpt-4o-mini
VITE_OPENAI_BASE_URL=https://api.openai.com/v1
VITE_LEGIS_GA_LEGISCAN_SESSION_ID=optional_legiscan_session_override
VITE_LEGIS_GA_SESSION_ID=optional_matching_legis_ga_session_override
```

### Server-side variables (LC scraper)

These are **not** `VITE_*` and are only read by the Node host (`server.js` / `server/lcRecheck.js`). Set them on the deployment that runs `npm start` (e.g. Render):

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
LEGISCAN_SESSION_ID=your_legiscan_session_id
LEGIS_GA_SESSION_ID=the_matching_legis_ga_session_id
LC_RECHECK_SECRET=a_long_random_string          # gates POST /api/lc-recheck
LC_RECHECK_INTERVAL_MS=3600000                  # optional, default 1 hour
```

The scraper is disabled automatically when credentials or either side of the
explicit provider-session mapping is absent. It verifies the configured
`LEGIS_GA_SESSION_ID` against the current legis.ga.gov session before writing.

Get your Supabase URL and anon key from **Project Settings → API** in the [Supabase dashboard](https://supabase.com/dashboard).

## Database Setup

### Step 1 — Run the migration

Apply every SQL file in `supabase/migrations` in numeric order. Existing
deployments must apply `034_legiscan_session_isolation.sql` and
`035_remove_legacy_session_zero.sql` together with
the matching application release; older number-only upserts and RPC calls are
intentionally incompatible with the session-safe schema. This creates:

- `profiles` — one row per user; its obsolete legacy tracking array is cleared
- `tracked_bill_ids` — session-scoped personal tracking with positive session IDs only
- `bills` — full, session-scoped bill records synced from LegiScan
- `teams`, `team_members`, `team_bills` — team collaboration tables
- `email_lists`, `notifications`, `tweets` — supporting tables
- Row Level Security policies so users only access their own data
- Trigger to auto-create a profile row when a new user registers

### Step 2 — Create RPC functions

Run the following in your Supabase **SQL Editor** to create the security definer functions needed for team features:

```sql
-- Breaks RLS recursion between teams ↔ team_members
create or replace function public.my_team_ids()
returns setof uuid language sql security definer stable as $$
  select id from public.teams where created_by = auth.uid()
  union
  select team_id from public.team_members where user_id = auth.uid()
$$;

-- Pending invite helpers
drop function if exists public.get_my_pending_invites();
create or replace function public.get_my_pending_invites()
returns table(id uuid, team_id uuid, invite_email text, role text, status text, team_name text)
language plpgsql security definer as $$
begin
  return query
    select tm.id, tm.team_id, tm.email, tm.role, tm.status, t.name
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where lower(tm.email) = lower((select u.email from auth.users u where u.id = auth.uid()))
      and tm.status = 'pending';
end;
$$;

create or replace function public.accept_my_team_invites()
returns void language plpgsql security definer as $$
begin
  update public.team_members
  set user_id = auth.uid(), status = 'active'
  where lower(email) = lower((select email from auth.users where id = auth.uid()))
    and status = 'pending';
end;
$$;

create or replace function public.decline_my_team_invite(invite_id uuid)
returns void language plpgsql security definer as $$
begin
  delete from public.team_members
  where id = invite_id
    and lower(email) = lower((select email from auth.users where id = auth.uid()))
    and status = 'pending';
end;
$$;

create or replace function public.remove_team_member(member_id uuid)
returns void language plpgsql security definer as $$
begin
  delete from public.team_members
  where id = member_id
    and team_id in (select id from public.teams where created_by = auth.uid());
end;
$$;

create or replace function public.leave_my_team(p_team_id uuid)
returns void language plpgsql security definer as $$
begin
  delete from public.team_members
  where team_id = p_team_id
    and user_id = auth.uid()
    and role = 'member';
end;
$$;
```

## Local Development

```bash
npm install
npm run dev
```

Other scripts:

```bash
npm run build      # produce the static dist/ bundle
npm start          # run the Node server (serves dist/, API proxy, LC scraper)
npm run preview
npm run lint
npm run lint:fix
npm run typecheck
```

> `npm run dev` (Vite) does **not** run the LC scraper or API proxy. Use `npm run build && npm start` to exercise the Node server locally, though the scraper itself cannot reach legis.ga.gov from most non-US networks.

## Deploying

The Vite static build can deploy to **Vercel** or **Netlify**. However, the **LC-number scraper requires a Node host** that runs `npm start` (`server.js`) — deploy to **Render** (or a similar US-based Node host) so the scheduler and `POST /api/lc-recheck` endpoint can reach legis.ga.gov.

Add these environment variables in your hosting dashboard:

- `VITE_LEGISCAN_API_KEY`
- `VITE_OPENAI_API_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- optional `VITE_LEGIS_GA_LEGISCAN_SESSION_ID` override
- optional `VITE_LEGIS_GA_SESSION_ID` override
- optional `VITE_OPENAI_MODEL`
- optional `VITE_OPENAI_BASE_URL`

For the LC scraper (Node host only): `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `LEGISCAN_SESSION_ID`,
`LEGIS_GA_SESSION_ID`, `LC_RECHECK_SECRET`, and optional
`LC_RECHECK_INTERVAL_MS`.

## Security Warning (Important)

Because this is a Vite client app, all `VITE_*` variables are bundled into the client bundle and visible to end users. Supabase Row Level Security ensures each user can only read and write their own data even if the anon key is exposed. For the OpenAI key, consider moving AI calls to a backend/serverless function for production use.

## Project Structure (high level)

```
src/
  pages/
    Dashboard.jsx        – main bill list, search, filter, track toggle, add to team
    TrackedBills.jsx     – bills the user is tracking
    Comparison.jsx       – compare bill versions/substitutes with AI summary (4 modes)
    Team.jsx             – team management: members, invite, shared bills, leave team
    Calendar.jsx         – Georgia committee meeting calendar
    Committees.jsx       – committees, members, and assigned bills
    TwitterFeed.jsx      – embedded legislative news feed
    Login.jsx            – login form
    Register.jsx         – registration form
    Settings.jsx         – user settings (profile, username, avatar)
    EmailLists.jsx       – email list management
  components/
    TeamChat.jsx         – real-time team chat with emoji, file upload, drag-drop
    bills/
      BillCard.jsx       – bill card with track + add-to-team buttons + LC number
      BillDetailsModal   – bill details + AI analysis + track/team actions
      BillSyncButton     – Refreshes current/changed LegiScan sessions
      BillFilters        – filter UI
  services/
    legiscan.js          – LegiScan API fetch/parsing + Comparison helpers
    legisGa.js           – legis.ga.gov API (LC versions, committees, meetings)
    openstates.js        – OpenStates GraphQL helpers (via server proxy)
  api/
    apiClient.js         – all data ops (Supabase CRUD + RPC calls + OpenAI + LcTracking)
  lib/
    supabase.js          – Supabase client instance
    AuthContext.jsx      – global auth state (session, login, register, logout)
    query-client.js      – React Query client (5-min stale time)
server.js               – Node HTTP server: static hosting + API proxy + LC-recheck route
server/
  lcRecheck.js          – all-bills LC scraper + hourly scheduler
```
