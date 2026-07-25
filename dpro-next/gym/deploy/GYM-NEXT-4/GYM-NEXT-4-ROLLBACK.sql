-- ============================================================
-- STEP GYM-NEXT-4 ROLLBACK
-- セッション記録データを削除せず、バックアップテーブルへ退避します。
--
-- 実行前にCloudflare Workerを旧Worker URLへ戻してください。
-- ============================================================

begin;

drop function if exists public.gym_complete_session_next(
  uuid, text, text, text, text, text, text, text
);

drop function if exists public.gym_upsert_session_record(
  uuid, text, text, text, text, text, text, text, text
);

drop function if exists public.gym_update_reservation_status_next(
  uuid, text, text, text, text
);

drop function if exists public.gym_assert_reservation_transition_next(
  text, text
);

drop function if exists public.gym_next_4_system_check(text);

drop index if exists public.gym_ticket_ledger_completion_once_idx;

do $$
begin
  if to_regclass('public.gym_session_records') is not null
     and to_regclass(
       'public.gym_session_records_next4_backup_20260725'
     ) is null then
    alter table public.gym_session_records
      rename to gym_session_records_next4_backup_20260725;
  end if;
end;
$$;

insert into public.gym_activity_logs (
  facility_code,
  action,
  target_type,
  target_id,
  detail,
  created_by
) values (
  'dpro_gym_demo',
  'gym_next_4_rollback_applied',
  'system',
  'GYM-NEXT-4',
  jsonb_build_object(
    'session_records_preserved_as',
    'gym_session_records_next4_backup_20260725'
  ),
  'rollback'
);

commit;

select jsonb_build_object(
  'ok', true,
  'rollback', 'GYM-NEXT-4',
  'session_records_preserved',
  to_regclass(
    'public.gym_session_records_next4_backup_20260725'
  ) is not null
) as gym_next_4_rollback_result;
