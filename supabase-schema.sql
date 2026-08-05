-- BigHub Supabase schema
-- 1) Run this in Supabase SQL Editor.
-- 2) Auth > Sign In / Providers > Email: disable email confirmation for MVP.
-- 3) Auth > Users: create admin@bighub.local / your admin password.
-- 4) Run the final "seed admin profile" block after creating that Auth user.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  login_id text not null unique check (login_id ~ '^[a-z0-9._-]{3,32}$'),
  auth_email text not null unique,
  name text not null,
  department text not null check (department in ('임원', '경영지원', '개발', '운영', '마케팅', '기타')),
  role text not null default 'member' check (role in ('admin', 'member')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  avatar text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id)
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('general', 'notice', 'mission', 'question')),
  title text not null,
  body text not null,
  media_url text,
  attachment_url text,
  start_date date,
  due_date date,
  completion_rules text[] not null default array[]::text[],
  created_at timestamptz not null default now()
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
alter table public.posts enable row level security;
alter table public.mission_targets enable row level security;
alter table public.comments enable row level security;
alter table public.reactions enable row level security;
alter table public.mission_events enable row level security;
alter table public.posts add column if not exists attachment_name text not null default '';
alter table public.posts add column if not exists attachment_mime_type text not null default '';
alter table public.posts add column if not exists updated_at timestamptz;
alter table public.comments add column if not exists parent_id uuid references public.comments(id) on delete cascade;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.posts to authenticated;
grant select, insert, update, delete on public.mission_targets to authenticated;
grant select, insert, update, delete on public.comments to authenticated;
grant select, insert, update, delete on public.reactions to authenticated;
grant select, insert, update, delete on public.mission_events to authenticated;
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


create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_login_id text := lower(coalesce(new.raw_user_meta_data->>'login_id', split_part(new.email, '@', 1)));
  requested_name text := coalesce(nullif(new.raw_user_meta_data->>'name', ''), requested_login_id);
  requested_department text := coalesce(nullif(new.raw_user_meta_data->>'department', ''), '기타');
begin
  if requested_department not in ('임원', '경영지원', '개발', '운영', '마케팅', '기타') then
    requested_department := '기타';
  end if;

  insert into public.profiles (id, login_id, auth_email, name, department, role, status, avatar)
  values (new.id, requested_login_id, new.email, requested_name, requested_department, 'member', 'pending', left(requested_name, 1))
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user_profile();

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_approved() to authenticated;
grant execute on function public.handle_new_user_profile() to authenticated;

-- Repair Auth users created before the trigger existed.
insert into public.profiles (id, login_id, auth_email, name, department, role, status, avatar)
select
  u.id,
  lower(coalesce(u.raw_user_meta_data->>'login_id', split_part(u.email, '@', 1))),
  u.email,
  coalesce(nullif(u.raw_user_meta_data->>'name', ''), split_part(u.email, '@', 1)),
  case
    when coalesce(u.raw_user_meta_data->>'department', '') in ('임원', '경영지원', '개발', '운영', '마케팅', '기타') then u.raw_user_meta_data->>'department'
    else '기타'
  end,
  'member',
  'pending',
  left(coalesce(nullif(u.raw_user_meta_data->>'name', ''), split_part(u.email, '@', 1)), 1)
from auth.users u
where u.email <> 'admin@bighub.local'
  and not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;
drop policy if exists "profiles insert own pending" on public.profiles;
create policy "profiles insert own pending" on public.profiles
for insert to authenticated
with check (auth.uid() = id and role = 'member' and status = 'pending');

drop policy if exists "profiles select own or admin" on public.profiles;
create policy "profiles select own or admin" on public.profiles
for select to authenticated
using (auth.uid() = id or public.is_admin() or public.is_approved());

drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update" on public.profiles
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "approved select posts" on public.posts;
create policy "approved select posts" on public.posts for select to authenticated using (public.is_approved());

drop policy if exists "approved insert posts" on public.posts;
create policy "approved insert posts" on public.posts for insert to authenticated with check (public.is_approved() and author_id = auth.uid());

drop policy if exists "author or admin update posts" on public.posts;
create policy "author or admin update posts" on public.posts for update to authenticated using (author_id = auth.uid() or public.is_admin()) with check (author_id = auth.uid() or public.is_admin());

drop policy if exists "author or admin delete posts" on public.posts;
create policy "author or admin delete posts" on public.posts for delete to authenticated using (author_id = auth.uid() or public.is_admin());

drop policy if exists "approved select mission targets" on public.mission_targets;
create policy "approved select mission targets" on public.mission_targets for select to authenticated using (public.is_approved());

drop policy if exists "author or admin insert mission targets" on public.mission_targets;
create policy "author or admin insert mission targets" on public.mission_targets for insert to authenticated with check (public.is_approved());
drop policy if exists "author or admin delete mission targets" on public.mission_targets;
create policy "author or admin delete mission targets" on public.mission_targets for delete to authenticated using (public.is_approved());

drop policy if exists "approved select comments" on public.comments;
create policy "approved select comments" on public.comments for select to authenticated using (public.is_approved());

drop policy if exists "approved insert comments" on public.comments;
create policy "approved insert comments" on public.comments for insert to authenticated with check (public.is_approved() and user_id = auth.uid());
drop policy if exists "own or admin delete comments" on public.comments;
create policy "own or admin delete comments" on public.comments for delete to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "approved select reactions" on public.reactions;
create policy "approved select reactions" on public.reactions for select to authenticated using (public.is_approved());

drop policy if exists "approved insert reactions" on public.reactions;
create policy "approved insert reactions" on public.reactions for insert to authenticated with check (public.is_approved() and user_id = auth.uid());

drop policy if exists "own or admin delete reactions" on public.reactions;
create policy "own or admin delete reactions" on public.reactions for delete to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "approved select mission events" on public.mission_events;
create policy "approved select mission events" on public.mission_events for select to authenticated using (public.is_approved());

drop policy if exists "approved insert own mission events" on public.mission_events;
create policy "approved insert own mission events" on public.mission_events for insert to authenticated with check (public.is_approved() and user_id = auth.uid());

-- Run after creating Auth user admin@bighub.local in Authentication > Users.
insert into public.profiles (id, login_id, auth_email, name, department, role, status, avatar, approved_at)
select id, 'admin', 'admin@bighub.local', '관리자', '임원', 'admin', 'approved', '관', now()
from auth.users
where email = 'admin@bighub.local'
on conflict (id) do update set
  role = 'admin',
  status = 'approved',
  approved_at = coalesce(public.profiles.approved_at, now());