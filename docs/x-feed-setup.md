# X Feed deployment

The X collector is an early-alert source only. It never writes bill status to
`public.bills` or `public.legislative_bill_cache`.

## 1. Apply the database migration

Run `supabase/migrations/038_x_feed_early_alerts.sql` in Supabase before
deploying the updated server.

## 2. Configure the Render server

Create an X developer app with access to the X API recent-post search endpoint,
then add these server-side environment variables:

```text
X_BEARER_TOKEN=your-app-only-bearer-token
X_MONITORED_HANDLES=GAHouseHub,GASenatePress
X_LEGISCAN_SESSION_IDS=your-current-legiscan-session-id
X_SYNC_INTERVAL_MS=60000
X_SYNC_SECRET=an-optional-manual-trigger-secret
```

`X_BEARER_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY` must never use a `VITE_`
prefix. They are server secrets.

When `X_LEGISCAN_SESSION_IDS` is blank, the collector uses the existing
`LEGISCAN_SESSION_ID`. If regular and special sessions are both active, list
both verified LegiScan IDs or deploy with the currently active one. Posts that
cannot be assigned safely are stored in `x_unmatched_posts` for retry instead
of being guessed into a session.

## 3. Verify the connection

The scheduler runs shortly after server startup and then at the configured
interval. An administrator can also trigger it manually:

```text
POST /api/x-feed-sync
x-x-sync-secret: your-X_SYNC_SECRET
```

Check the latest run:

```sql
select *
from public.x_feed_sync_state
where state = 'GA';
```

Check session-scoped detections:

```sql
select
  movement.session_id,
  movement.bill_ref,
  movement.movement_type,
  post.account_handle,
  post.posted_at,
  post.content
from public.x_bill_movements as movement
join public.x_posts as post
  using (state, session_id, post_id)
order by post.posted_at desc;
```
