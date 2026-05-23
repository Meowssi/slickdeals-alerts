-- User feedback queue. Users submit feedback from /feedback; admins read it
-- from /admin/feedback (via service_role, bypassing RLS).

create table if not exists public.feedback (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  user_email      text not null,
  category        text not null check (category in ('bug', 'feature', 'question', 'other')),
  subject         text not null check (length(subject) between 1 and 200),
  message         text not null check (length(message) between 1 and 5000),
  status          text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  admin_response  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists feedback_user_id_idx on public.feedback (user_id, created_at desc);
create index if not exists feedback_status_idx  on public.feedback (status, created_at desc);

drop trigger if exists feedback_set_updated_at on public.feedback;
create trigger feedback_set_updated_at
  before update on public.feedback
  for each row execute function public.set_updated_at();

alter table public.feedback enable row level security;

drop policy if exists feedback_select_own on public.feedback;
create policy feedback_select_own on public.feedback
  for select using (auth.uid() = user_id);

drop policy if exists feedback_insert_own on public.feedback;
create policy feedback_insert_own on public.feedback
  for insert with check (auth.uid() = user_id);
