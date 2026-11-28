-- Requires the outbox migration, deployed worker and independently configured
-- Vault secret printly_owner_email_scheduler_v1. The secret is never stored in
-- the cron command. Stop with: select cron.unschedule('printly-owner-email-dispatch');
select cron.schedule('printly-owner-email-dispatch','*/5 * * * *',$job$
  do $run$
  declare secret text; response extensions.http_response; totals jsonb;
  begin
    select decrypted_secret into secret from vault.decrypted_secrets where name='printly_owner_email_scheduler_v1';
    if secret is null or length(secret)<32 then raise exception 'Email worker secret unavailable'; end if;
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','240000');
    select * into response from extensions.http(('POST','https://lgfqetnfazawglwllymb.supabase.co/functions/v1/owner-email-dispatch',
      array[extensions.http_header('Authorization','Bearer '||secret)],'application/json','{}')::extensions.http_request);
    if response.status<>200 then raise exception 'Email worker HTTP %',response.status; end if;
    totals := response.content::jsonb;
    if coalesce((totals->>'failed')::int,0)>0 or coalesce((totals->>'unknown')::int,0)>0 or coalesce((totals->>'retry')::int,0)>0 then
      raise exception 'Email worker reported failed, unknown, or retry outcomes';
    end if;
  end $run$;
$job$);
