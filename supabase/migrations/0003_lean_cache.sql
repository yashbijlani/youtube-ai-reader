-- Lean canonical cache.
--
-- Chunks are derived from the transcript and are rebuilt in memory per request,
-- so the persisted chunk table is no longer needed. The cache version is stored
-- in `videos.metadata` (jsonb), so no column is required.

drop table if exists public.video_chunks;

-- Remove cached rows whose title is a placeholder, so a bad entry from an older
-- bug cannot be served. Safe to run multiple times.
delete from public.video_analysis
where video_id in (select id from public.videos where title is null or title = 'Untitled video');
delete from public.transcripts
where video_id in (select id from public.videos where title is null or title = 'Untitled video');
delete from public.videos
where title is null or title = 'Untitled video';
