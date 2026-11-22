-- Extend the existing shared limiter without changing existing bucket behavior.
-- All values passed by the application are keyed hashes, never IPs or draft IDs.
create or replace function public.consume_public_rate_limit(p_bucket text, p_client_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_limit integer;
  v_seconds integer;
  v_hits integer;
  v_end timestamptz;
begin
  case p_bucket
    when 'signup' then v_limit := 10; v_seconds := 3600;
    when 'name_check' then v_limit := 120; v_seconds := 600;
    when 'order_start' then v_limit := 120; v_seconds := 900;
    when 'dropbox_import' then v_limit := 30; v_seconds := 600;
    when 'order_feedback' then v_limit := 30; v_seconds := 3600;
    -- The login preflight is an additional application-layer limit only.
    -- Direct Supabase Auth requests remain subject to Supabase's own limits.
    when 'login_attempt' then v_limit := 12; v_seconds := 600;
    when 'upload_issue' then v_limit := 60; v_seconds := 900;
    -- A draft cookie expires 24 hours after creation; this window starts no
    -- earlier than that, so it cannot reset during that cookie's lifetime.
    when 'draft_upload_issue' then v_limit := 30; v_seconds := 86400;
    when 'draft_dropbox_import' then v_limit := 20; v_seconds := 86400;
    when 'file_processing' then v_limit := 120; v_seconds := 900;
    when 'draft_changes' then v_limit := 180; v_seconds := 900;
    when 'checkout' then v_limit := 30; v_seconds := 900;
    when 'tracking' then v_limit := 600; v_seconds := 600;
    else raise exception 'INVALID_RATE_LIMIT_BUCKET' using errcode = 'P0001';
  end case;
  if p_client_hash is null or p_client_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_RATE_LIMIT_KEY' using errcode = 'P0001';
  end if;

  insert into public.security_rate_limits as r (bucket, client_hash, hits, window_ends_at)
  values (p_bucket, p_client_hash, 1, now() + make_interval(secs => v_seconds))
  on conflict (bucket, client_hash) do update set
    hits = case when r.window_ends_at <= now() then 1 else least(r.hits + 1, v_limit + 1) end,
    window_ends_at = case when r.window_ends_at <= now() then now() + make_interval(secs => v_seconds) else r.window_ends_at end
  returning hits, window_ends_at into v_hits, v_end;

  if random() < 0.02 then
    delete from public.security_rate_limits where ctid in (
      select ctid from public.security_rate_limits
      where window_ends_at < now() - interval '1 day' order by window_ends_at limit 100
    );
  end if;
  return jsonb_build_object('allowed', v_hits <= v_limit,
    'retry_after', greatest(1, ceil(extract(epoch from v_end - now()))::integer));
end
$$;
revoke all on function public.consume_public_rate_limit(text,text) from public, anon, authenticated;
grant execute on function public.consume_public_rate_limit(text,text) to service_role;
