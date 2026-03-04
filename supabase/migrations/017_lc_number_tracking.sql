-- Add lc_number column to bills table (if not exists)
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS lc_number text;

-- LC number change tracking per user.
-- Stores the current known LC for each tracked bill and detects changes across syncs.
CREATE TABLE IF NOT EXISTS public.bill_lc_tracking (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bill_number     text NOT NULL,
  current_lc      text,                  -- latest known LC number
  previous_lc     text,                  -- LC before the last change (null if no change detected)
  lc_changed_at   timestamptz,           -- when the change was detected
  change_seen     boolean DEFAULT true,  -- false when user hasn't seen the change yet
  last_checked    timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now() NOT NULL,
  updated_at      timestamptz DEFAULT now() NOT NULL,
  UNIQUE (user_id, bill_number)
);

ALTER TABLE public.bill_lc_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own lc tracking"
  ON public.bill_lc_tracking FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
