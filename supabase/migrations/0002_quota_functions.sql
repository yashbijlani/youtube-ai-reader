-- Atomic quota consumption.
--
-- Locking the user's row serialises concurrent checks for the same user, so two
-- simultaneous requests cannot both slip past the last free slot. Active
-- subscriptions bypass free limits.

create or replace function public.consume_video_quota(
    p_user uuid,
    p_video text,
    p_lifetime_limit integer,
    p_monthly_limit integer,
    p_period text
)
returns table (allowed boolean, reason text, used integer, remaining integer, limit_value integer)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_status text;
    v_lifetime integer;
    v_month integer;
begin
    -- Serialise quota decisions per user.
    perform 1 from public.users where id = p_user for update;
    if not found then
        return query select false, 'user_missing', 0, 0, p_lifetime_limit;
        return;
    end if;

    select coalesce(max(status), 'FREE') into v_status
    from public.subscriptions where user_id = p_user;

    if v_status = 'ACTIVE' then
        return query select true, 'pro', 0, 0, -1;
        return;
    end if;

    select count(*) into v_lifetime from public.used_videos where user_id = p_user;

    -- Already used by this user: never counts twice.
    if exists (select 1 from public.used_videos where user_id = p_user and video_id = p_video) then
        return query select true, 'already_used', v_lifetime, greatest(p_lifetime_limit - v_lifetime, 0), p_lifetime_limit;
        return;
    end if;

    if v_lifetime >= p_lifetime_limit then
        return query select false, 'lifetime_limit', v_lifetime, 0, p_lifetime_limit;
        return;
    end if;

    insert into public.usage_periods (user_id, period, videos_used)
    values (p_user, p_period, 0)
    on conflict (user_id, period) do nothing;

    select videos_used into v_month
    from public.usage_periods
    where user_id = p_user and period = p_period
    for update;

    if v_month >= p_monthly_limit then
        return query select false, 'monthly_limit', v_lifetime, 0, p_monthly_limit;
        return;
    end if;

    insert into public.used_videos (user_id, video_id)
    values (p_user, p_video)
    on conflict (user_id, video_id) do nothing;

    update public.usage_periods
    set videos_used = videos_used + 1, updated_at = now()
    where user_id = p_user and period = p_period;

    return query select true, 'ok', v_lifetime + 1, greatest(p_lifetime_limit - (v_lifetime + 1), 0), p_lifetime_limit;
end;
$$;

create or replace function public.consume_chat_quota(
    p_user uuid,
    p_monthly_limit integer,
    p_period text
)
returns table (allowed boolean, reason text, used integer, remaining integer, limit_value integer)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_status text;
    v_month integer;
begin
    perform 1 from public.users where id = p_user for update;
    if not found then
        return query select false, 'user_missing', 0, 0, p_monthly_limit;
        return;
    end if;

    select coalesce(max(status), 'FREE') into v_status
    from public.subscriptions where user_id = p_user;

    if v_status = 'ACTIVE' then
        return query select true, 'pro', 0, 0, -1;
        return;
    end if;

    insert into public.usage_periods (user_id, period, chat_messages)
    values (p_user, p_period, 0)
    on conflict (user_id, period) do nothing;

    select chat_messages into v_month
    from public.usage_periods
    where user_id = p_user and period = p_period
    for update;

    if v_month >= p_monthly_limit then
        return query select false, 'chat_limit', v_month, 0, p_monthly_limit;
        return;
    end if;

    update public.usage_periods
    set chat_messages = chat_messages + 1, updated_at = now()
    where user_id = p_user and period = p_period;

    return query select true, 'ok', v_month + 1, greatest(p_monthly_limit - (v_month + 1), 0), p_monthly_limit;
end;
$$;
