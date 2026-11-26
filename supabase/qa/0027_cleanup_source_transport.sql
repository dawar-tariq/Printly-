-- ONLY for the independently verified isolated QA project
-- rahfmpsdbwbktlobntkm, after the reviewed source has been applied and the
-- migration history has been checked. This removes only temporary transport.
-- It intentionally does not grant either worker claim or delete app data.
drop function public.stage_native_qa_0027_f4f04e902c(text);
drop table public.native_qa_migration_source_f4f04e902c;
notify pgrst, 'reload schema';
