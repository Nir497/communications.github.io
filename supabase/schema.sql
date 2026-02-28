-- Run in Supabase SQL Editor
-- This creates a shared account/profile directory plus chat tables for future migration.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  display_name text not null check (char_length(display_name) between 1 and 64),
  avatar_color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('dm', 'group')),
  title text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz
);

create table if not exists public.chat_memberships (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  left_at timestamptz
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_profile_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('text', 'system', 'file', 'image', 'mixed')),
  text text,
  attachment_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  chat_id uuid not null references public.chats(id) on delete cascade,
  kind text not null check (kind in ('image', 'file')),
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_memberships_chat_id on public.chat_memberships(chat_id);
create index if not exists idx_chat_memberships_profile_id on public.chat_memberships(profile_id);
create index if not exists idx_messages_chat_created on public.messages(chat_id, created_at);
create index if not exists idx_attachments_message_id on public.attachments(message_id);

alter table public.profiles enable row level security;
alter table public.chats enable row level security;
alter table public.chat_memberships enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;

-- Helper functions to avoid recursive RLS evaluation on chat_memberships.
create or replace function public.is_chat_member(target_chat_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_memberships m
    where m.chat_id = target_chat_id
      and m.profile_id = auth.uid()
      and m.left_at is null
  );
$$;

create or replace function public.is_chat_owner(target_chat_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_memberships m
    where m.chat_id = target_chat_id
      and m.profile_id = auth.uid()
      and m.left_at is null
      and m.role = 'owner'
  );
$$;

grant execute on function public.is_chat_member(uuid) to authenticated;
grant execute on function public.is_chat_owner(uuid) to authenticated;

-- Profiles: any signed-in user can view profile directory; users can update only their own profile.
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Chat visibility and writes only for active members.
drop policy if exists "chats_select_member" on public.chats;
create policy "chats_select_member"
  on public.chats for select
  to authenticated
  using (public.is_chat_member(id));

drop policy if exists "chats_insert_authenticated" on public.chats;
create policy "chats_insert_authenticated"
  on public.chats for insert
  to authenticated
  with check (created_by = auth.uid());

drop policy if exists "chats_update_member" on public.chats;
create policy "chats_update_member"
  on public.chats for update
  to authenticated
  using (public.is_chat_member(id));

drop policy if exists "memberships_select_member" on public.chat_memberships;
create policy "memberships_select_member"
  on public.chat_memberships for select
  to authenticated
  using (public.is_chat_member(chat_id));

drop policy if exists "memberships_insert_member" on public.chat_memberships;
create policy "memberships_insert_member"
  on public.chat_memberships for insert
  to authenticated
  with check (
    public.is_chat_member(chat_id)
    or profile_id = auth.uid()
  );

drop policy if exists "memberships_update_self_or_member" on public.chat_memberships;
create policy "memberships_update_self_or_member"
  on public.chat_memberships for update
  to authenticated
  using (
    profile_id = auth.uid()
    or public.is_chat_member(chat_id)
  );

drop policy if exists "messages_select_member" on public.messages;
create policy "messages_select_member"
  on public.messages for select
  to authenticated
  using (public.is_chat_member(chat_id));

drop policy if exists "messages_insert_member" on public.messages;
create policy "messages_insert_member"
  on public.messages for insert
  to authenticated
  with check (
    sender_profile_id = auth.uid()
    and public.is_chat_member(chat_id)
  );

drop policy if exists "attachments_select_member" on public.attachments;
create policy "attachments_select_member"
  on public.attachments for select
  to authenticated
  using (public.is_chat_member(chat_id));

drop policy if exists "attachments_insert_member" on public.attachments;
create policy "attachments_insert_member"
  on public.attachments for insert
  to authenticated
  with check (public.is_chat_member(chat_id));

-- Optional: create a storage bucket named `chat-files` in the Supabase Dashboard.
