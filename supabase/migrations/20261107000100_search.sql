-- Global search across the signed-in user's transcripts and summaries.
-- security invoker => Row Level Security still applies (only own rows).
create function public.search_all(q text)
returns table (kind text, lesson_id uuid, course_id uuid, lesson_title text, body text, start_sec real, created_at timestamptz)
language sql stable security invoker set search_path = public as $$
  (
    select 'summary', l.id, l.course_id, l.title, l.summary::text, null::real, l.created_at
    from lessons l
    where length(q) >= 2
      and (strpos(lower(l.title), lower(q)) > 0 or strpos(lower(coalesce(l.summary::text, '')), lower(q)) > 0)
    order by l.created_at desc
    limit 40
  )
  union all
  (
    select 'segment', s.lesson_id, l.course_id, l.title, s.text, s.start_sec, l.created_at
    from transcript_segments s
    join lessons l on l.id = s.lesson_id
    where length(q) >= 2 and strpos(lower(s.text), lower(q)) > 0
    order by l.created_at desc, s.idx
    limit 80
  )
$$;
grant execute on function public.search_all(text) to authenticated;
