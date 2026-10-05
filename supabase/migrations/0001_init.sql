-- YouTube AI Reader — initial production schema
--
-- Canonical YouTube videos (transcript + chunks + analysis) are shared across
-- all users; user-specific state (auth, billing, quota, usage, chat) hangs off
-- the authenticated user. The backend performs all writes with the service-role
-- key; RLS only exposes user-owned rows as a defence-in-depth measure.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- users
create table if not exists public.users (
    id          uuid primary key references auth.users (id) on delete cascade,
    email       text,
    plan        text not null default 'free' check (plan in ('free', 'pro')),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------- devices
-- The anonymous extension install id, linked to a user after sign-in.
create table if not exists public.devices (
    install_id   text primary key,
    user_id      uuid references public.users (id) on delete set null,
    created_at   timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);
create index if not exists devices_user_id_idx on public.devices (user_id);

-- ------------------------------------------------------------------ videos
create table if not exists public.videos (
    id             text primary key,                     -- YouTube video id
    status         text not null default 'discovered'
                   check (status in ('discovered', 'transcript_pending', 'transcript_ready',
                                     'analysis_pending', 'ready', 'failed')),
    title          text,
    channel        text,
    duration       double precision,
    language       text,
    thumbnail      text,
    metadata       jsonb,
    error_code     text,
    error_message  text,
    model          text,
    prompt_version integer,
    processed_at   timestamptz,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);
create index if not exists videos_status_idx on public.videos (status);
create index if not exists videos_updated_at_idx on public.videos (updated_at desc);

-- ------------------------------------------------------------- transcripts
create table if not exists public.transcripts (
    video_id     text primary key references public.videos (id) on delete cascade,
    language     text,
    kind         text not null default 'none',           -- manual | auto | none
    source       text not null default 'server_ytdlp',    -- browser_intercept | caption_dom | server_ytdlp
    segments     jsonb not null default '[]'::jsonb,      -- [{start,end,text}]
    char_count   integer not null default 0,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

-- ------------------------------------------------------------------ chunks
create table if not exists public.video_chunks (
    video_id text not null references public.videos (id) on delete cascade,
    idx      integer not null,
    start_s  double precision not null,
    end_s    double precision not null,
    text     text not null,
    primary key (video_id, idx)
);
create index if not exists video_chunks_video_idx on public.video_chunks (video_id);

-- ---------------------------------------------------------------- analysis
create table if not exists public.video_analysis (
    video_id        text primary key references public.videos (id) on delete cascade,
    overview        text not null default '',
    key_points      jsonb not null default '[]'::jsonb,
    chapters        jsonb not null default '[]'::jsonb,
    detailed_reading text not null default '',
    quick_read      text not null default '',
    model           text,
    prompt_version  integer,
    degraded        boolean not null default false,
    degraded_reason text,
    generated_at    timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- --------------------------------------------------------------- chat
create table if not exists public.chat_sessions (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references public.users (id) on delete cascade,
    video_id   text not null references public.videos (id) on delete cascade,
    title      text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, video_id)
);
create index if not exists chat_sessions_user_idx on public.chat_sessions (user_id, updated_at desc);

create table if not exists public.chat_messages (
    id         uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.chat_sessions (id) on delete cascade,
    role       text not null check (role in ('user', 'assistant')),
    content    text not null,
    citations  jsonb not null default '[]'::jsonb,
    model      text,
    created_at timestamptz not null default now()
);
create index if not exists chat_messages_session_idx on public.chat_messages (session_id, created_at);

-- -------------------------------------------------------------- ai usage
create table if not exists public.ai_usage (
    id                 bigserial primary key,
    user_id            uuid references public.users (id) on delete set null,
    video_id           text,
    model              text not null,
    request_type       text,
    input_tokens       integer,
    output_tokens      integer,
    estimated_cost_usd numeric(12, 8) not null default 0,
    latency_ms         integer not null default 0,
    success            boolean not null default true,
    request_id         text,
    created_at         timestamptz not null default now()
);
create index if not exists ai_usage_user_idx on public.ai_usage (user_id, created_at desc);
create index if not exists ai_usage_video_idx on public.ai_usage (video_id, created_at desc);

-- --------------------------------------------------------- quota tracking
-- Lifetime distinct videos per user (free tier).
create table if not exists public.used_videos (
    user_id       uuid not null references public.users (id) on delete cascade,
    video_id      text not null,
    first_used_at timestamptz not null default now(),
    primary key (user_id, video_id)
);

-- Per-calendar-month counters.
create table if not exists public.usage_periods (
    user_id       uuid not null references public.users (id) on delete cascade,
    period        text not null,                          -- YYYY-MM (UTC)
    videos_used   integer not null default 0,
    chat_messages integer not null default 0,
    ai_cost_usd   numeric(12, 8) not null default 0,
    updated_at    timestamptz not null default now(),
    primary key (user_id, period)
);

-- ----------------------------------------------------------- subscriptions
create table if not exists public.subscriptions (
    id                       uuid primary key default gen_random_uuid(),
    user_id                  uuid not null unique references public.users (id) on delete cascade,
    provider                 text not null default 'razorpay',
    status                   text not null default 'FREE'
                             check (status in ('FREE', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED')),
    plan                     text not null default 'pro',
    provider_subscription_id text,
    provider_payment_id      text,
    current_period_end       timestamptz,
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now()
);
create index if not exists subscriptions_status_idx on public.subscriptions (status);
create index if not exists subscriptions_provider_sub_idx on public.subscriptions (provider_subscription_id);

-- ------------------------------------------------------ webhook idempotency
create table if not exists public.webhook_events (
    id          text primary key,                         -- provider event id
    provider    text not null default 'razorpay',
    event_type  text,
    processed_at timestamptz not null default now()
);

-- --------------------------------------------------------------- triggers
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

do $$
declare
    t text;
begin
    foreach t in array array['users', 'videos', 'transcripts', 'video_analysis', 'chat_sessions', 'subscriptions']
    loop
        execute format(
            'drop trigger if exists %I_touch on public.%I; create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at();',
            t, t, t, t
        );
    end loop;
end $$;

-- ------------------------------------------------------------------- RLS
-- The backend uses the service-role key and bypasses RLS. These policies exist
-- so that a leaked anon key still cannot read other users' private rows.
alter table public.users enable row level security;
alter table public.devices enable row level security;
alter table public.subscriptions enable row level security;
alter table public.used_videos enable row level security;
alter table public.usage_periods enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.ai_usage enable row level security;
alter table public.videos enable row level security;
alter table public.transcripts enable row level security;
alter table public.video_chunks enable row level security;
alter table public.video_analysis enable row level security;

do $$
begin
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'users_self') then
        create policy users_self on public.users for select using (auth.uid() = id);
        create policy devices_self on public.devices for select using (auth.uid() = user_id);
        create policy subscriptions_self on public.subscriptions for select using (auth.uid() = user_id);
        create policy used_videos_self on public.used_videos for select using (auth.uid() = user_id);
        create policy usage_periods_self on public.usage_periods for select using (auth.uid() = user_id);
        create policy ai_usage_self on public.ai_usage for select using (auth.uid() = user_id);
        create policy chat_sessions_self on public.chat_sessions for select using (auth.uid() = user_id);
        create policy chat_messages_self on public.chat_messages for select
            using (exists (select 1 from public.chat_sessions s where s.id = session_id and s.user_id = auth.uid()));
    end if;
    -- Canonical video data is shared product data, readable by any authenticated user.
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'videos' and policyname = 'videos_read') then
        create policy videos_read on public.videos for select using (auth.role() = 'authenticated');
        create policy transcripts_read on public.transcripts for select using (auth.role() = 'authenticated');
        create policy video_chunks_read on public.video_chunks for select using (auth.role() = 'authenticated');
        create policy video_analysis_read on public.video_analysis for select using (auth.role() = 'authenticated');
    end if;
end $$;
