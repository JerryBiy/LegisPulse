-- Add metadata columns to team_bills for the list/spreadsheet view
-- flag: 'low' | 'high' | null
-- policy_assistant: user_id of assigned team member (nullable)
-- bill_summary_notes: free-text editable notes (the "Bill Summary" column)

alter table public.team_bills
  add column if not exists flag              text,
  add column if not exists policy_assistant  uuid references auth.users(id) on delete set null,
  add column if not exists bill_summary_notes text default '';
