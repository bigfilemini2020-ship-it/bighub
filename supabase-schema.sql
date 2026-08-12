-- BigHub Supabase schema
-- 1) Run this file in Supabase SQL Editor.
-- 2) Auth > Sign In / Providers > Email: disable email confirmation for MVP.
-- 3) Auth > Users: create admin@bighub.local / your admin password.
-- 4) Set Edge Function secrets documented in supabase/functions/README.md.
-- 5) Deploy Edge Functions: request-signup, approve-signup, reject-signup, drive-upload, drive-download.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  login_id text not null unique check (login_id ~ '^[a-z0-9._-]{3,32}$'),
  auth_email text not null unique,
  name text not null,
  department text not null check (department in ('임원', '경영지원', '개발', '운영', '마케팅', '기타')),
  role text not null default 'member' check (role in ('admin', 'member')),
  status text not null default 'approved' check (status in ('approved', 'rejected')),
  avatar text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id)
);

create table if not exists public.signup_requests (
  id uuid primary key default gen_random_uuid(),
  login_id text not null unique check (login_id ~ '^[a-z0-9._-]{3,32}$'),
  name text not null,
  department text not null check (department in ('임원', '경영지원', '개발', '운영', '마케팅', '기타')),
  password_ciphertext text,
  password_iv text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id),
  user_id uuid references public.profiles(id)
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

create table if not exists public.mission_targets (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (post_id, user_id)
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

create table if not exists public.mission_events (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('download', 'done')),
  created_at timestamptz not null default now(),
  unique (post_id, user_id, event_type)
);

alter table public.profiles enable row level security;
alter table public.signup_requests enable row level security;
alter table public.posts enable row level security;
alter table public.mission_targets enable row level security;
alter table public.comments enable row level security;
alter table public.reactions enable row level security;
alter table public.mission_events enable row level security;

alter table public.posts add column if not exists attachment_name text not null default '';
alter table public.posts add column if not exists attachment_mime_type text not null default '';
alter table public.posts add column if not exists updated_at timestamptz;
alter table public.comments add column if not exists parent_id uuid references public.comments(id) on delete cascade;

-- Legacy cleanup: older builds created pending/rejected profiles directly in Auth.
-- New signup flow stores pending users only in signup_requests. The request-signup function
-- deletes stale pending/rejected Auth users for the same login_id before saving a new request.
drop trigger if exists on_auth_user_created on auth.users;
drop policy if exists "profiles insert own pending" on public.profiles;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'approved'
  );
$$;

create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved'
  );
$$;

create or replace function public.delete_post(post_id_input uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
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
$$;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
revoke update on public.profiles from authenticated;
grant update (avatar, status, approved_at, approved_by) on public.profiles to authenticated;
grant select, update on public.signup_requests to authenticated;
grant select, insert, update, delete on public.posts to authenticated;
grant select, insert, update, delete on public.mission_targets to authenticated;
grant select, insert, update, delete on public.comments to authenticated;
grant select, insert, update, delete on public.reactions to authenticated;
grant select, insert, update, delete on public.mission_events to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_approved() to authenticated;
grant execute on function public.delete_post(uuid) to authenticated;

drop policy if exists "profiles select own or admin" on public.profiles;
create policy "profiles select own or admin" on public.profiles
for select to authenticated
using (auth.uid() = id or public.is_admin() or public.is_approved());

drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update" on public.profiles
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "profiles update own avatar" on public.profiles;
create policy "profiles update own avatar" on public.profiles
for update to authenticated
using (auth.uid() = id and public.is_approved())
with check (auth.uid() = id and public.is_approved());

drop policy if exists "admins select signup requests" on public.signup_requests;
create policy "admins select signup requests" on public.signup_requests
for select to authenticated
using (public.is_admin());

drop policy if exists "admins update signup requests" on public.signup_requests;
create policy "admins update signup requests" on public.signup_requests
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "approved select posts" on public.posts;
create policy "approved select posts" on public.posts
for select to authenticated
using (public.is_approved());

drop policy if exists "approved insert posts" on public.posts;
create policy "approved insert posts" on public.posts
for insert to authenticated
with check (public.is_approved() and author_id = auth.uid() and (type <> 'notice' or public.is_admin()));

drop policy if exists "author or admin update posts" on public.posts;
create policy "author or admin update posts" on public.posts
for update to authenticated
using (author_id = auth.uid() or public.is_admin())
with check ((author_id = auth.uid() or public.is_admin()) and (type <> 'notice' or public.is_admin()));

drop policy if exists "author or admin delete posts" on public.posts;
create policy "author or admin delete posts" on public.posts
for delete to authenticated
using (author_id = auth.uid() or public.is_admin());

drop policy if exists "approved select mission targets" on public.mission_targets;
create policy "approved select mission targets" on public.mission_targets
for select to authenticated
using (public.is_approved());

drop policy if exists "author or admin insert mission targets" on public.mission_targets;
create policy "author or admin insert mission targets" on public.mission_targets
for insert to authenticated
with check (
  public.is_admin()
  or exists (select 1 from public.posts where id = post_id and author_id = auth.uid())
);

drop policy if exists "author or admin delete mission targets" on public.mission_targets;
create policy "author or admin delete mission targets" on public.mission_targets
for delete to authenticated
using (
  public.is_admin()
  or exists (select 1 from public.posts where id = post_id and author_id = auth.uid())
);

drop policy if exists "approved select comments" on public.comments;
create policy "approved select comments" on public.comments
for select to authenticated
using (public.is_approved());

drop policy if exists "approved insert comments" on public.comments;
create policy "approved insert comments" on public.comments
for insert to authenticated
with check (public.is_approved() and user_id = auth.uid());

drop policy if exists "own or admin delete comments" on public.comments;
create policy "own or admin delete comments" on public.comments
for delete to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "approved select reactions" on public.reactions;
create policy "approved select reactions" on public.reactions
for select to authenticated
using (public.is_approved());

drop policy if exists "approved insert reactions" on public.reactions;
create policy "approved insert reactions" on public.reactions
for insert to authenticated
with check (public.is_approved() and user_id = auth.uid());

drop policy if exists "own or admin delete reactions" on public.reactions;
create policy "own or admin delete reactions" on public.reactions
for delete to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "approved select mission events" on public.mission_events;
create policy "approved select mission events" on public.mission_events
for select to authenticated
using (public.is_approved());

drop policy if exists "approved insert own mission events" on public.mission_events;
create policy "approved insert own mission events" on public.mission_events
for insert to authenticated
with check (public.is_approved() and user_id = auth.uid());

-- Run after creating Auth user admin@bighub.local in Authentication > Users.
insert into public.profiles (id, login_id, auth_email, name, department, role, status, avatar, approved_at)
select id, 'admin', 'admin@bighub.local', '관리자', '임원', 'admin', 'approved', '관', now()
from auth.users
where email = 'admin@bighub.local'
on conflict (id) do update set
  role = 'admin',
  status = 'approved',
  approved_at = coalesce(public.profiles.approved_at, now());
