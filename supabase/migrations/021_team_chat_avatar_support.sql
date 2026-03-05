-- Include profile avatar URLs in team chat RPC responses.

-- Read messages RPC
DROP FUNCTION IF EXISTS public.get_team_chat_messages(uuid);
CREATE OR REPLACE FUNCTION public.get_team_chat_messages(p_team_id uuid)
RETURNS TABLE (
  id              uuid,
  team_id         uuid,
  user_id         uuid,
  message         text,
  created_at      timestamptz,
  sender_name     text,
  sender_email    text,
  sender_avatar_url text,
  attachment_url  text,
  attachment_name text,
  attachment_type text,
  attachment_size bigint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    m.id,
    m.team_id,
    m.user_id,
    m.message,
    m.created_at,
    p.name AS sender_name,
    p.email AS sender_email,
    p.avatar_url AS sender_avatar_url,
    m.attachment_url,
    m.attachment_name,
    m.attachment_type,
    m.attachment_size
  FROM public.team_chat_messages m
  LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE m.team_id = p_team_id
    AND p_team_id IN (SELECT public.get_my_team_ids())
  ORDER BY m.created_at ASC
  LIMIT 200;
$$;

-- Send message RPC (with attachment overload)
DROP FUNCTION IF EXISTS public.send_team_chat_message(uuid, text, text, text, text, bigint);
DROP FUNCTION IF EXISTS public.send_team_chat_message(uuid, text);
CREATE OR REPLACE FUNCTION public.send_team_chat_message(
  p_team_id         uuid,
  p_message         text,
  p_attachment_url  text default null,
  p_attachment_name text default null,
  p_attachment_type text default null,
  p_attachment_size bigint default null
)
RETURNS TABLE (
  id                uuid,
  team_id           uuid,
  user_id           uuid,
  message           text,
  created_at        timestamptz,
  sender_name       text,
  sender_email      text,
  sender_avatar_url text,
  attachment_url    text,
  attachment_name   text,
  attachment_type   text,
  attachment_size   bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH inserted AS (
    INSERT INTO public.team_chat_messages
      (team_id, user_id, message, attachment_url, attachment_name, attachment_type, attachment_size)
    SELECT
      p_team_id, auth.uid(), trim(p_message),
      p_attachment_url, p_attachment_name, p_attachment_type, p_attachment_size
    WHERE p_team_id IN (SELECT public.get_my_team_ids())
    RETURNING
      team_chat_messages.id,
      team_chat_messages.team_id,
      team_chat_messages.user_id,
      team_chat_messages.message,
      team_chat_messages.created_at,
      team_chat_messages.attachment_url,
      team_chat_messages.attachment_name,
      team_chat_messages.attachment_type,
      team_chat_messages.attachment_size
  )
  SELECT
    ins.id,
    ins.team_id,
    ins.user_id,
    ins.message,
    ins.created_at,
    pr.name AS sender_name,
    pr.email AS sender_email,
    pr.avatar_url AS sender_avatar_url,
    ins.attachment_url,
    ins.attachment_name,
    ins.attachment_type,
    ins.attachment_size
  FROM inserted ins
  LEFT JOIN public.profiles pr ON pr.id = ins.user_id;
$$;

-- Team member profile enrichment RPC
DROP FUNCTION IF EXISTS public.get_team_member_profiles(uuid);
CREATE OR REPLACE FUNCTION public.get_team_member_profiles(p_team_id uuid)
RETURNS TABLE (
  id         uuid,
  name       text,
  email      text,
  avatar_url text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p.id, p.name, p.email, p.avatar_url
  FROM public.profiles p
  WHERE p.id IN (
    SELECT tm.user_id FROM public.team_members tm
    WHERE tm.team_id = p_team_id
      AND tm.status = 'active'
      AND tm.user_id IS NOT NULL
    UNION
    SELECT t.created_by FROM public.teams t
    WHERE t.id = p_team_id
  )
  AND p_team_id IN (SELECT public.get_my_team_ids());
$$;
