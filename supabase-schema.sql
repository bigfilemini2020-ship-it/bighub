-- BigHub schema — regenerated from the live database on 2026-08-12.
--
-- Source of truth: project kxorrekxpwkpggvdgwru, after migration
-- consolidate_permission_layer_20260812 + restrict_profiles_update_to_avatar_column_20260812.
-- The previous version of this file had drifted from production and carried
-- mojibake in its Korean literals; this one is UTF-8 throughout.
--
-- Intended use: bootstrapping a NEW project. Production is maintained by
-- migrations — do not re-run this file against it wholesale.
--
-- Bootstrapping an admin is deliberately not scripted here: it needs an
-- auth.users row first. Create the account, then flip role/status by hand.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Legacy cleanup
--
-- Profiles used to be created by an auth trigger. Signup now goes through
-- public.request_signup + public.approve_signup_request instead, so both the
-- trigger and its function are gone. Kept here so an old database converges.
-- ---------------------------------------------------------------------------

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user_profile();

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  login_id text not null unique check (login_id ~ '^[a-z0-9._-]{3,32}$'),
  auth_email text not null unique,
  name text not null,
  department text not null check (department in ('임원', '경영지원', '개발', '운영', '마케팅', '기타')),
  role text not null default 'member' check (role in ('admin', 'member')),
  status text not null default 'pending' check (status in ('pending', 'approved')),
  avatar text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id)
);

-- Temporary holding area. A row lives here only while a request is pending;
-- approval converts it into a profile, rejection deletes it outright. There is
-- no 'rejected' state — see public.reject_signup_request.
create table if not exists public.signup_requests (
  id uuid primary key default gen_random_uuid(),
  login_id text not null unique check (login_id ~ '^[a-z0-9._-]{3,32}$'),
  name text not null,
  department text not null check (department in ('임원', '경영지원', '개발', '운영', '마케팅', '기타')),
  password_ciphertext text,
  password_iv text,
  status text not null default 'pending' check (status in ('pending', 'approved')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  constraint signup_requests_pending_password_check
    check (status <> 'pending' or (coalesce(password_ciphertext, '') <> '' and coalesce(password_iv, '') <> ''))
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('general', 'notice', 'mission', 'question')),
  title text not null,
  body text not null,
  media_url text,
  attachment_url text,
  attachment_name text not null default '',
  attachment_mime_type text not null default '',
  start_date date,
  due_date date,
  completion_rules text[] not null default array[]::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  sticker text not null check (sticker in ('like', 'done')),
  created_at timestamptz not null default now(),
  unique (post_id, user_id, sticker)
);

create table if not exists public.mission_targets (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (post_id, user_id)
);

create table if not exists public.mission_events (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('download', 'done', 'comment')),
  created_at timestamptz not null default now(),
  unique (post_id, user_id, event_type)
);

-- ---------------------------------------------------------------------------
-- Indexes (foreign keys are not indexed automatically)
-- ---------------------------------------------------------------------------

create index if not exists profiles_approved_by_idx on public.profiles (approved_by);
create index if not exists signup_requests_decided_by_idx on public.signup_requests (decided_by);
create index if not exists signup_requests_user_id_idx on public.signup_requests (user_id);
create index if not exists posts_author_id_idx on public.posts (author_id);
create index if not exists comments_post_id_idx on public.comments (post_id);
create index if not exists comments_user_id_idx on public.comments (user_id);
create index if not exists comments_parent_id_idx on public.comments (parent_id);
create index if not exists reactions_user_id_idx on public.reactions (user_id);
create index if not exists mission_targets_user_id_idx on public.mission_targets (user_id);
create index if not exists mission_events_user_id_idx on public.mission_events (user_id);

-- ---------------------------------------------------------------------------
-- Helper functions
--
-- SECURITY DEFINER so a policy can read public.profiles without recursing
-- through that table's own RLS. Wrapped as (select public.is_admin()) at the
-- call sites so the planner evaluates them once per statement.
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'approved'
  );
$fn$;

create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved'
  );
$fn$;

-- ---------------------------------------------------------------------------
-- Signup lifecycle
--
-- request  -> a pending signup_requests row (no auth user, no profile yet)
-- approve  -> profile created/updated, request marked approved, secrets wiped
-- reject   -> the pending row is deleted, so the login id frees up again
-- ---------------------------------------------------------------------------

-- Called by the request-signup edge function with the service key. The password
-- arrives already encrypted; this function never sees the plaintext.
create or replace function public.request_signup(
  login_id_input text,
  name_input text,
  department_input text,
  password_ciphertext_input text,
  password_iv_input text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  existing_request_status text;
begin
  login_id_input := lower(trim(login_id_input));
  name_input := trim(name_input);
  department_input := trim(department_input);

  if login_id_input !~ '^[a-z0-9._-]{3,32}$' then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'invalid-login-id');
  end if;
  if name_input = '' then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'missing-name');
  end if;
  if department_input not in ('임원', '경영지원', '개발', '운영', '마케팅', '기타') then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'invalid-department');
  end if;
  if coalesce(password_ciphertext_input, '') = '' or coalesce(password_iv_input, '') = '' then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'missing-encrypted-password');
  end if;
  if exists (select 1 from public.profiles where login_id = login_id_input and status = 'approved') then
    return jsonb_build_object('ok', false, 'status', 409, 'error', 'signup-already-approved');
  end if;
  if (select count(*) from public.signup_requests where status = 'pending' and created_at > now() - interval '10 minutes') >= 50 then
    return jsonb_build_object('ok', false, 'status', 429, 'error', 'signup-rate-limited');
  end if;

  insert into public.signup_requests (login_id, name, department, password_ciphertext, password_iv, status, created_at, decided_at, decided_by, user_id)
  values (login_id_input, name_input, department_input, password_ciphertext_input, password_iv_input, 'pending', now(), null, null, null)
  on conflict (login_id) do nothing;
  if found then return jsonb_build_object('ok', true); end if;

  select status into existing_request_status from public.signup_requests where login_id = login_id_input;
  if existing_request_status = 'pending' then
    return jsonb_build_object('ok', false, 'status', 409, 'error', 'signup-pending');
  end if;
  return jsonb_build_object('ok', false, 'status', 409, 'error', 'signup-already-approved');
end;
$fn$;

-- Called by the approve-signup edge function after it has created the auth user.
-- Profile creation and request bookkeeping share one transaction so a failure
-- cannot leave a half-approved account behind.
create or replace function public.approve_signup_request(
  request_id_input uuid,
  user_id_input uuid,
  approved_by_input uuid
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  request_row public.signup_requests%rowtype;
  approved_now timestamptz := now();
begin
  select * into request_row
  from public.signup_requests
  where id = request_id_input and status = 'pending'
  for update;
  if not found then return false; end if;

  insert into public.profiles (id, login_id, auth_email, name, department, role, status, avatar, approved_at, approved_by)
  values (user_id_input, request_row.login_id, request_row.login_id || '@bighub.local', request_row.name, request_row.department, 'member', 'approved', left(request_row.name, 1), approved_now, approved_by_input)
  on conflict (id) do update set
    login_id = excluded.login_id,
    auth_email = excluded.auth_email,
    name = excluded.name,
    department = excluded.department,
    role = 'member',
    status = 'approved',
    avatar = excluded.avatar,
    approved_at = excluded.approved_at,
    approved_by = excluded.approved_by;

  update public.signup_requests
  set status = 'approved', password_ciphertext = null, password_iv = null, decided_at = approved_now, decided_by = approved_by_input, user_id = user_id_input
  where id = request_id_input and status = 'pending';
  return found;
end;
$fn$;

-- Called by the reject-signup edge function with the caller's own token, so the
-- admin check runs against auth.uid(). Deletes rather than marking rejected:
-- the login id must be reusable afterwards.
create or replace function public.reject_signup_request(request_id_input uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  deleted_count integer := 0;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception '관리자만 처리할 수 있습니다.';
  end if;

  delete from public.signup_requests
  where id = request_id_input
    and status = 'pending';

  get diagnostics deleted_count = row_count;
  return deleted_count > 0;
end;
$fn$;

-- A pending signup has no auth.users row yet (the account is created at
-- approval), so signInWithPassword returns "invalid login credentials" and the
-- client cannot tell "wrong password" from "waiting for approval". The status
-- check inside signIn runs only after a successful sign-in, which a pending user
-- never reaches, so the client asks this on failure instead.
--
-- Reveals nothing the signup form does not: submitting a taken id there already
-- returns 409 "already registered or pending". Says nothing about approved
-- accounts, so it cannot be used to enumerate members.
create or replace function public.signup_is_pending(login_id_input text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select exists (
    select 1 from public.signup_requests
    where login_id = lower(trim(login_id_input)) and status = 'pending'
  );
$fn$;

-- Fallback used by the client when a plain delete removes no rows, so the UI can
-- tell "not allowed" apart from "already gone".
create or replace function public.delete_post(post_id_input uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  deleted_count integer := 0;
begin
  if auth.uid() is null or not public.is_approved() then
    return false;
  end if;

  delete from public.posts
  where id = post_id_input
    and (author_id = auth.uid() or public.is_admin());

  get diagnostics deleted_count = row_count;
  return deleted_count > 0;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.signup_requests enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.reactions enable row level security;
alter table public.mission_targets enable row level security;
alter table public.mission_events enable row level security;

-- A pending or unapproved member can read only their own row.
drop policy if exists "profiles select own or admin" on public.profiles;
create policy "profiles select own or admin" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id or (select public.is_admin()) or (select public.is_approved()));

-- Row scope only. The column scope lives in the grant below — without it this
-- policy would also permit writing role and status.
drop policy if exists "profiles update own avatar" on public.profiles;
create policy "profiles update own avatar" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id and (select public.is_approved()))
  with check ((select auth.uid()) = id and (select public.is_approved()));

-- No insert or delete policy on profiles: both go through the SECURITY DEFINER
-- functions above.

drop policy if exists "admins select signup requests" on public.signup_requests;
create policy "admins select signup requests" on public.signup_requests
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "admins update signup requests" on public.signup_requests;
create policy "admins update signup requests" on public.signup_requests
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "approved select posts" on public.posts;
create policy "approved select posts" on public.posts
  for select to authenticated
  using ((select public.is_approved()));

drop policy if exists "approved insert posts" on public.posts;
create policy "approved insert posts" on public.posts
  for insert to authenticated
  with check ((select public.is_approved()) and author_id = (select auth.uid()) and (type <> 'notice' or (select public.is_admin())));

drop policy if exists "author or admin update posts" on public.posts;
create policy "author or admin update posts" on public.posts
  for update to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()))
  with check ((author_id = (select auth.uid()) or (select public.is_admin())) and (type <> 'notice' or (select public.is_admin())));

drop policy if exists "author or admin delete posts" on public.posts;
create policy "author or admin delete posts" on public.posts
  for delete to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "approved select comments" on public.comments;
create policy "approved select comments" on public.comments
  for select to authenticated
  using ((select public.is_approved()));

drop policy if exists "approved insert comments" on public.comments;
create policy "approved insert comments" on public.comments
  for insert to authenticated
  with check ((select public.is_approved()) and user_id = (select auth.uid()));

drop policy if exists "own or admin delete comments" on public.comments;
create policy "own or admin delete comments" on public.comments
  for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "approved select reactions" on public.reactions;
create policy "approved select reactions" on public.reactions
  for select to authenticated
  using ((select public.is_approved()));

drop policy if exists "approved insert reactions" on public.reactions;
create policy "approved insert reactions" on public.reactions
  for insert to authenticated
  with check ((select public.is_approved()) and user_id = (select auth.uid()));

drop policy if exists "own or admin delete reactions" on public.reactions;
create policy "own or admin delete reactions" on public.reactions
  for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "approved select mission targets" on public.mission_targets;
create policy "approved select mission targets" on public.mission_targets
  for select to authenticated
  using ((select public.is_approved()));

drop policy if exists "author or admin insert mission targets" on public.mission_targets;
create policy "author or admin insert mission targets" on public.mission_targets
  for insert to authenticated
  with check ((select public.is_admin()) or exists (
    select 1 from public.posts
    where posts.id = mission_targets.post_id and posts.author_id = (select auth.uid())
  ));

drop policy if exists "author or admin delete mission targets" on public.mission_targets;
create policy "author or admin delete mission targets" on public.mission_targets
  for delete to authenticated
  using ((select public.is_admin()) or exists (
    select 1 from public.posts
    where posts.id = mission_targets.post_id and posts.author_id = (select auth.uid())
  ));

drop policy if exists "approved select mission events" on public.mission_events;
create policy "approved select mission events" on public.mission_events
  for select to authenticated
  using ((select public.is_approved()));

drop policy if exists "approved insert own mission events" on public.mission_events;
create policy "approved insert own mission events" on public.mission_events
  for insert to authenticated
  with check ((select public.is_approved()) and user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Grants
--
-- RLS decides which rows; grants decide which tables and columns. Both matter:
-- a policy with no matching grant fails with 42501, and a grant wider than the
-- policy assumes is a hole the policy cannot close.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated, service_role;

-- anon reaches the database only through the signup edge function, which uses
-- the service key. It gets nothing directly.

grant select, insert, update, delete on public.posts to authenticated;
grant select, insert, delete on public.comments to authenticated;
grant select, insert, delete on public.reactions to authenticated;
grant select, insert, delete on public.mission_targets to authenticated;
grant select, insert, delete on public.mission_events to authenticated;
grant select on public.profiles to authenticated;
grant select, update on public.signup_requests to authenticated;

-- Column scope for the avatar policy. Table-level update here would let an
-- approved member satisfy "profiles update own avatar" while writing role.
revoke update on public.profiles from authenticated;
grant update (avatar) on public.profiles to authenticated;

-- service_role backs the edge functions and already bypasses RLS; withholding
-- table grants from it only breaks those functions.
grant select, insert, update, delete on all tables in schema public to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;

-- SECURITY DEFINER functions default to PUBLIC execute. Close that, then grant
-- to the one role that should call each.
revoke execute on function public.is_admin() from public;
revoke execute on function public.is_approved() from public;
revoke execute on function public.delete_post(uuid) from public;
revoke execute on function public.request_signup(text, text, text, text, text) from public;
revoke execute on function public.signup_is_pending(text) from public;
revoke execute on function public.approve_signup_request(uuid, uuid, uuid) from public;
revoke execute on function public.reject_signup_request(uuid) from public;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_approved() to authenticated;
grant execute on function public.delete_post(uuid) to authenticated;
grant execute on function public.reject_signup_request(uuid) to authenticated;
grant execute on function public.signup_is_pending(text) to anon, authenticated;
grant execute on function public.request_signup(text, text, text, text, text) to service_role;
grant execute on function public.approve_signup_request(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Safety net: enable RLS on any table created in public from here on.
-- ---------------------------------------------------------------------------

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $fn$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name = 'public' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    else
      raise log 'rls_auto_enable: skip % (schema %)', cmd.object_identity, cmd.schema_name;
    end if;
  end loop;
end;
$fn$;

drop event trigger if exists ensure_rls;
create event trigger ensure_rls on ddl_command_end execute function public.rls_auto_enable();
