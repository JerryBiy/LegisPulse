# LegisPulse

LegisPulse tracks Georgia legislative bills and provides AI-generated bill analysis. Built for Georgia legislative staff and advocates to monitor bill activity, track legislation of interest, and get instant AI summaries of bill changes.

## Current Capabilities

- **User accounts** — register, log in, and log out with email/password (powered by Supabase Auth)
- **Per-user data** — tracked bills, email lists, and notifications are stored in a cloud database, tied to your account
- Sync Georgia bills from LegiScan (full session, 4000+ bills via paginated fetch)
- Show newest bills first (higher bill number first)
- Search by bill number/text with improved exact matching (e.g. `HB10` and `HB 10`)
- Track/untrack bills — persisted to your account across devices
- Open direct bill PDFs (uses LegiScan `getBillText` flow when available)
- Fetch and display sponsor lists (cards + details)
- Generate and regenerate AI summaries from bill text context (`summary` + `changes_analysis`)
- Instant tab navigation — data is cached in memory so switching pages does not reload from the server

## Tech Stack

- React 18 + Vite
- Tailwind CSS + Radix UI (shadcn/ui components)
- **Supabase** — PostgreSQL database + Row Level Security + Auth
- **@tanstack/react-query** — client-side data caching (5-minute stale time, shared cache keys)
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

Run `supabase/migrations/001_initial_schema.sql` once in your Supabase project's **SQL Editor**. This creates:

- `profiles` — one row per user, stores `tracked_bill_ids` (jsonb array)
- `bills` — full bill records synced from LegiScan
- `email_lists`, `notifications`, `tweets` — supporting tables
- Row Level Security policies so users only access their own data
- Trigger to auto-create a profile row when a new user registers

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
    Dashboard.jsx        – main bill list, search, filter, track toggle
    TrackedBills.jsx     – bills the user is tracking
    Login.jsx            – login form
    Register.jsx         – registration form
    Settings.jsx         – user settings
    EmailLists.jsx       – email list management
  components/
    bills/
      BillDetailsModal   – bill details + AI analysis
      BillSyncButton     – LegiScan sync action
      BillFilters        – filter UI
  services/
    legiscan.js          – LegiScan API fetch/parsing helpers
  api/
    apiClient.js         – all data ops (Supabase CRUD + OpenAI calls)
  lib/
    supabase.js          – Supabase client instance
    AuthContext.jsx      – global auth state (session, login, register, logout)
    query-client.js      – React Query client (5-min stale time)
```
