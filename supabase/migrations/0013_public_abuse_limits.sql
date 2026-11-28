-- Distributed, atomic fixed-window limits for expensive public application
-- routes. The application sends an HMAC of the IP address, never the IP itself.
create table if not exists public.security_rate_limits (
  bucket text not null,
  client_hash text not null check (client_hash ~ '^[0-9a-f]{64}$'),
  hits integer not null check (hits > 0),
  window_ends_at timestamptz not null,
  primary key (bucket, client_hash)
);
create index if not exists security_rate_limits_expiry_idx on public.security_rate_limits (window_ends_at);
alter table public.security_rate_limits enable row level security;
revoke all on public.security_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.security_rate_limits to service_role;

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

  -- Opportunistically bound stale data. At most 100 old entries are removed
  -- occasionally; a quiet deployment may retain expired hashes until later use.
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
