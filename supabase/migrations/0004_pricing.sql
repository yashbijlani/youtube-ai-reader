-- Pricing v2: monthly-only quotas (free + pro), per-cycle periods, refunds.
--
-- * Free:  p_free_monthly_limit videos per period.
-- * Pro:   p_pro_monthly_limit videos per period (active subscription).
-- * No lifetime cap: reuse of the same video never counts twice.
-- * release_video_quota refunds a reservation when processing failed.

alter table public.subscriptions
    add column if not exists current_period_start timestamptz;

drop function if exists public.consume_video_quota(uuid, text, integer, integer, text);

create or replace function public.consume_video_quota(
    p_user uuid,
    p_video text,
    p_free_monthly_limit integer,
    p_pro_monthly_limit integer,
    p_period text
)
returns table (
    allowed boolean,
    reason text,
    used integer,
    remaining integer,
    limit_value integer,
    plan text
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_status text;
    v_plan text := 'free';
    v_limit integer;
    v_month integer;
begin
    -- Serialise quota decisions per user.
    perform 1 from public.users where id = p_user for update;
    if not found then
        return query select false, 'user_missing', 0, 0, p_free_monthly_limit, 'free';
        return;
    end if;

    select coalesce(max(status), 'FREE') into v_status
    from public.subscriptions where user_id = p_user;

    if v_status = 'ACTIVE' then
        v_plan := 'pro';
        v_limit := p_pro_monthly_limit;
    else
        v_limit := p_free_monthly_limit;
    end if;

    insert into public.usage_periods (user_id, period, videos_used)
    values (p_user, p_period, 0)
    on conflict (user_id, period) do nothing;

    -- Already counted for this user/period: never counts twice.
    if exists (select 1 from public.used_videos where user_id = p_user and video_id = p_video) then
        select videos_used into v_month
        from public.usage_periods
        where user_id = p_user and period = p_period;
        return query select true, 'already_used', v_month, greatest(v_limit - v_month, 0), v_limit, v_plan;
        return;
    end if;

    select videos_used into v_month
    from public.usage_periods
    where user_id = p_user and period = p_period
    for update;

    if v_month >= v_limit then
        return query select false, 'monthly_limit', v_month, 0, v_limit, v_plan;
        return;
    end if;

    insert into public.used_videos (user_id, video_id)
    values (p_user, p_video)
    on conflict (user_id, video_id) do nothing;

    update public.usage_periods
    set videos_used = videos_used + 1, updated_at = now()
    where user_id = p_user and period = p_period;

    return query select true, 'ok', v_month + 1, greatest(v_limit - (v_month + 1), 0), v_limit, v_plan;
end;
$$;

create or replace function public.release_video_quota(
    p_user uuid,
    p_video text,
    p_period text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_deleted integer;
begin
    delete from public.used_videos
    where user_id = p_user and video_id = p_video;
    get diagnostics v_deleted = row_count;

    if v_deleted > 0 then
        update public.usage_periods
        set videos_used = greatest(videos_used - 1, 0), updated_at = now()
        where user_id = p_user and period = p_period;
        return true;
    end if;
    return false;
end;
$$;
