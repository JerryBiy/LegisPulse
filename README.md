# LegisPulse

LegisPulse tracks Georgia legislative bills and provides AI-generated bill analysis. Built for Georgia legislative staff and advocates to monitor bill activity, track legislation of interest, share bills with teammates, and get instant AI summaries of bill changes.

## Current Capabilities

- **User accounts** — register, log in, and log out with email/password (powered by Supabase Auth)
- **Per-user data** — tracked bills, email lists, and notifications are stored in a cloud database, tied to your account
- **Team collaboration** — create a team, invite colleagues by email, share bills across the team
- **Team chat** — real-time messaging between team members with emoji, file/image attachments, drag-and-drop upload, and auto-expiry after 2½ weeks
- Sync Georgia bills from LegiScan (full session, 4000+ bills via paginated fetch)
- Auto-sync on first load when no bills are in the database
- Show newest bills first (higher bill number first)
- Search by bill number/text with improved exact matching (e.g. `HB10` and `HB 10`)
- Track/untrack bills — persisted to your account across devices
- Add/remove bills to your team's shared list
- Open direct bill PDFs (uses LegiScan `getBillText` flow when available)
- Fetch and display sponsor lists (cards + details)
- Generate and regenerate AI summaries from bill text context (`summary` + `changes_analysis`)
- Instant tab navigation — data is cached in memory so switching pages does not reload from the server
- Scroll position and "load more" count are remembered when navigating away from Dashboard

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

| File                         | Purpose                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `003_team_chat.sql`          | Base `team_chat_messages` table, RLS, Realtime, cleanup function, pg_cron job |
| `004_chat_rls_fix.sql`       | `get_my_team_ids()` helper, recreated RLS policies                            |
| `005_chat_messages_rpc.sql`  | `get_team_chat_messages` RPC                                                  |
| `006_chat_send_rpc.sql`      | `send_team_chat_message` RPC                                                  |
| `007_chat_all_functions.sql` | Comprehensive file with all 5 chat functions                                  |
| `008_chat_attachments.sql`   | Attachment columns, storage bucket, updated RPCs                              |

Run each migration in the Supabase **SQL Editor** in order.

## Tech Stack

- React 18 + Vite
- Tailwind CSS + Radix UI (shadcn/ui components)
- **Supabase** — PostgreSQL database + Row Level Security + Auth + Realtime + Storage
- **@tanstack/react-query** — client-side data caching (5-minute stale time, shared cache keys)
- **@emoji-mart/react** — emoji picker for team chat
- `src/api/apiClient.js` — unified data layer over Supabase

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
```

Get your Supabase URL and anon key from **Project Settings → API** in the [Supabase dashboard](https://supabase.com/dashboard).

## Database Setup

### Step 1 — Run the migration

Run `supabase/migrations/001_initial_schema.sql` once in your Supabase project's **SQL Editor**. This creates:

- `profiles` — one row per user, stores `tracked_bill_ids` (jsonb array)
- `bills` — full bill records synced from LegiScan
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
npm run build
npm run preview
npm run lint
npm run lint:fix
npm run typecheck
```

## Deploying

This is a static Vite build — deploy to **Vercel**, **Netlify**, or **Render**.

Add these environment variables in your hosting dashboard:

- `VITE_LEGISCAN_API_KEY`
- `VITE_OPENAI_API_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- optional `VITE_OPENAI_MODEL`
- optional `VITE_OPENAI_BASE_URL`

## Security Warning (Important)

Because this is a Vite client app, all `VITE_*` variables are bundled into the client bundle and visible to end users. Supabase Row Level Security ensures each user can only read and write their own data even if the anon key is exposed. For the OpenAI key, consider moving AI calls to a backend/serverless function for production use.

## Project Structure (high level)

```
src/
  pages/
    Dashboard.jsx        – main bill list, search, filter, track toggle, add to team
    TrackedBills.jsx     – bills the user is tracking
    Team.jsx             – team management: members, invite, shared bills, leave team
    Login.jsx            – login form
    Register.jsx         – registration form
    Settings.jsx         – user settings
    EmailLists.jsx       – email list management
  components/
    TeamChat.jsx         – real-time team chat with emoji, file upload, drag-drop
    bills/
      BillCard.jsx       – bill card with track + add-to-team buttons
      BillDetailsModal   – bill details + AI analysis + track/team actions
      BillSyncButton     – LegiScan sync action (auto-syncs when DB is empty)
      BillFilters        – filter UI
  services/
    legiscan.js          – LegiScan API fetch/parsing helpers
  api/
    apiClient.js         – all data ops (Supabase CRUD + RPC calls + OpenAI)
  lib/
    supabase.js          – Supabase client instance
    AuthContext.jsx      – global auth state (session, login, register, logout)
    query-client.js      – React Query client (5-min stale time)
```
