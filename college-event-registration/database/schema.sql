-- =====================================================================
-- COLLEGE EVENT REGISTRATION  -  Supabase PostgreSQL schema
-- Run this whole file once in: Supabase Dashboard > SQL Editor > New query
-- It is safe to run again (uses IF NOT EXISTS / OR REPLACE where possible).
-- =====================================================================

-- ---------- 1. Tables -------------------------------------------------

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  title       text        not null check (char_length(title) between 3 and 120),
  description text        not null default '' check (char_length(description) <= 1000),
  venue       text        not null check (char_length(venue) between 2 and 120),
  event_date  timestamptz not null,
  capacity    integer     not null check (capacity between 1 and 10000),
  category    text        not null default 'Other'
              check (category in ('Technical','Cultural','Sports','Workshop','Seminar','Other')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.registrations (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid        not null references public.events(id) on delete cascade,
  student_name text        not null check (char_length(student_name) between 2 and 80),
  email        text        not null check (email = lower(email) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'),
  roll_number  text        not null check (char_length(roll_number) between 3 and 30),
  department   text        not null check (char_length(department) between 2 and 60),
  year         integer     not null check (year between 1 and 4),
  created_at   timestamptz not null default now(),
  -- One student (email) can register only once per event
  constraint registrations_event_email_unique unique (event_id, email)
);

-- ---------- 2. Indexes ------------------------------------------------

create index if not exists idx_events_event_date        on public.events (event_date);
create index if not exists idx_events_category          on public.events (category);
create index if not exists idx_registrations_event_id   on public.registrations (event_id);
create index if not exists idx_registrations_email      on public.registrations (email);

-- ---------- 3. Trigger: keep events.updated_at fresh ------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_events_updated_at on public.events;
create trigger trg_events_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- ---------- 4. Function: register safely (no overbooking) -------------
-- Locks the event row, checks the date and the seats left, then inserts.
-- Two students clicking "Register" at the same moment cannot take the last seat twice.

create or replace function public.register_for_event(
  p_event_id uuid,
  p_name     text,
  p_email    text,
  p_roll     text,
  p_dept     text,
  p_year     integer
)
returns public.registrations
language plpgsql
set search_path = public
as $$
declare
  ev  public.events;
  cnt integer;
  reg public.registrations;
begin
  select * into ev from public.events where id = p_event_id for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND';
  end if;

  if ev.event_date <= now() then
    raise exception 'EVENT_PAST';
  end if;

  select count(*) into cnt from public.registrations where event_id = p_event_id;
  if cnt >= ev.capacity then
    raise exception 'EVENT_FULL';
  end if;

  insert into public.registrations (event_id, student_name, email, roll_number, department, year)
  values (p_event_id, p_name, lower(p_email), p_roll, p_dept, p_year)
  returning * into reg;

  return reg;
end;
$$;

-- Only the backend (service role) may call this function, never the browser directly.
revoke execute on function public.register_for_event(uuid, text, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.register_for_event(uuid, text, text, text, text, integer)
  to service_role;

-- ---------- 5. Row Level Security (RLS) -------------------------------
-- RLS stays ON for both tables.
--   events        : anyone may READ (public event list). Nobody can change rows
--                   through the public API keys.
--   registrations : contains personal data, so NO policy is given to anon /
--                   authenticated users = they cannot read or write it at all.
-- The Express backend uses the secret/service_role key, which bypasses RLS,
-- and it decides who may do what (admin password, email check).

alter table public.events        enable row level security;
alter table public.registrations enable row level security;

drop policy if exists "Public can read events" on public.events;
create policy "Public can read events"
  on public.events for select
  to anon, authenticated
  using (true);

drop policy if exists "Backend manages events" on public.events;
create policy "Backend manages events"
  on public.events for all
  to service_role
  using (true) with check (true);

drop policy if exists "Backend manages registrations" on public.registrations;
create policy "Backend manages registrations"
  on public.registrations for all
  to service_role
  using (true) with check (true);

-- ---------- 6. Optional sample data (only inserted if table is empty) --

insert into public.events (title, description, venue, event_date, capacity, category)
select * from (values
  ('Hack the Campus 24h',   'A 24-hour beginner-friendly hackathon. Form teams of up to four and build something useful for your college.', 'Innovation Lab, Block C', now() + interval '10 days', 60,  'Technical'),
  ('Inter-Department Cricket Cup', 'Knockout cricket tournament. Teams of 11 plus two substitutes.', 'Main Ground', now() + interval '14 days', 22, 'Sports'),
  ('Annual Cultural Night', 'Music, dance and drama performances by students. Open to all years.', 'Open Air Auditorium', now() + interval '21 days', 300, 'Cultural'),
  ('Git and GitHub Workshop', 'Hands-on session: commits, branches, pull requests. Bring your laptop.', 'Seminar Hall 2', now() + interval '5 days', 40, 'Workshop')
) as v(title, description, venue, event_date, capacity, category)
where not exists (select 1 from public.events);
