-- הממלכה של גל — database schema
-- Every table is private per user via Row Level Security: a signed-in user can
-- only ever see and change rows where user_id = their own auth id.

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  vocabulary text not null default '',
  color text not null default '#4c2a85',
  exam_date date,
  notebook jsonb,
  notebook_updated_at timestamptz,
  notebook_lesson_ids uuid[] not null default '{}',
  study_plan jsonb,
  study_plan_done text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index courses_user_idx on public.courses (user_id, created_at desc);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null default 'שיעור',
  title_edited boolean not null default false,
  status text not null default 'recording'
    check (status in ('recording', 'transcribing', 'summarizing', 'ready', 'error')),
  source text not null default 'record' check (source in ('record', 'upload')),
  input_done boolean not null default false,
  duration_sec real not null default 0,
  segment_count int not null default 0,
  bookmarks jsonb not null default '[]',
  notes text not null default '',
  parts jsonb not null default '[]',
  summary jsonb,
  quiz jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lessons_course_idx on public.lessons (course_id, created_at);
create index lessons_user_idx on public.lessons (user_id, created_at desc);

create table public.transcript_segments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  idx int not null,
  start_sec real not null,
  duration_sec real not null,
  text text not null default '',
  silent boolean not null default false,
  created_at timestamptz not null default now(),
  unique (lesson_id, idx)
);
create index segments_user_idx on public.transcript_segments (user_id);

create table public.flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  lesson_id uuid references public.lessons (id) on delete cascade,
  front text not null,
  back text not null,
  box int not null default 1 check (box between 1 and 5),
  due_at timestamptz not null default now(),
  reviews int not null default 0,
  created_at timestamptz not null default now()
);
create index flashcards_due_idx on public.flashcards (user_id, due_at);
create index flashcards_course_idx on public.flashcards (course_id);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  lesson_id uuid references public.lessons (id) on delete cascade,
  kind text not null check (kind in ('lesson', 'exam', 'mistakes')),
  score int not null check (score between 0 and 100),
  questions jsonb not null,
  answers jsonb not null,
  duration_sec int,
  created_at timestamptz not null default now()
);
create index attempts_course_idx on public.quiz_attempts (course_id, created_at desc);

-- keep lessons.updated_at fresh
create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
create trigger lessons_touch before update on public.lessons
  for each row execute function public.touch_updated_at();

-- Row Level Security: owner-only access on every table.
do $$
declare t text;
begin
  foreach t in array array['courses', 'lessons', 'transcript_segments', 'flashcards', 'quiz_attempts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "owner can do everything" on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- A lesson/segment/flashcard/attempt may only point at the user's own parents.
create function public.assert_owns_course() returns trigger
language plpgsql security invoker as $$
begin
  if not exists (select 1 from public.courses c where c.id = new.course_id and c.user_id = new.user_id) then
    raise exception 'course does not belong to user';
  end if;
  return new;
end $$;
create trigger lessons_owns_course before insert or update of course_id on public.lessons
  for each row execute function public.assert_owns_course();
create trigger flashcards_owns_course before insert or update of course_id on public.flashcards
  for each row execute function public.assert_owns_course();
create trigger attempts_owns_course before insert or update of course_id on public.quiz_attempts
  for each row execute function public.assert_owns_course();

create function public.assert_owns_lesson() returns trigger
language plpgsql security invoker as $$
begin
  if new.lesson_id is not null and not exists (
    select 1 from public.lessons l where l.id = new.lesson_id and l.user_id = new.user_id
  ) then
    raise exception 'lesson does not belong to user';
  end if;
  return new;
end $$;
create trigger segments_owns_lesson before insert or update of lesson_id on public.transcript_segments
  for each row execute function public.assert_owns_lesson();
create trigger flashcards_owns_lesson before insert or update of lesson_id on public.flashcards
  for each row execute function public.assert_owns_lesson();
create trigger attempts_owns_lesson before insert or update of lesson_id on public.quiz_attempts
  for each row execute function public.assert_owns_lesson();

grant select, insert, update, delete on all tables in schema public to authenticated;
