-- Production operational job; it is not a Supabase uptime guarantee.
-- This internal scheduler cannot run while the project is paused. The public
-- endpoint reads the current app release through the production database.
-- No credentials or customer information are included in the request.
-- To stop: select cron.unschedule('printly-daily-activity-check');
select cron.schedule(
  'printly-daily-activity-check',
  '17 4 * * *', -- 04:17 UTC daily
  $job$
    do $check$
    declare result_status integer;
    begin
      select status into result_status
      from extensions.http_get('https://printly0.vercel.app/api/native/v1/app-release');
      if result_status is distinct from 200 then
        raise exception 'Daily activity endpoint returned HTTP %', result_status;
      end if;
    end $check$;
  $job$
);
