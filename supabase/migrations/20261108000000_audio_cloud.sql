-- Cloud backup of lesson audio (Supabase Storage).
-- Files live at audio/<user_id>/<lesson_id>/<idx>.<ext>; each user can only touch their own folder.

insert into storage.buckets (id, name, public, file_size_limit)
values ('audio', 'audio', false, 26214400)
on conflict (id) do nothing;

create policy "audio: owner read" on storage.objects for select to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "audio: owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "audio: owner update" on storage.objects for update to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "audio: owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

alter table public.transcript_segments
  add column audio_path text,
  add column audio_bytes int not null default 0;

-- Total cloud audio of the signed-in user (RLS applies: security invoker).
create function public.audio_usage()
returns bigint language sql stable security invoker set search_path = public as $$
  select coalesce(sum(audio_bytes), 0)::bigint from transcript_segments where audio_path is not null
$$;
grant execute on function public.audio_usage() to authenticated;
