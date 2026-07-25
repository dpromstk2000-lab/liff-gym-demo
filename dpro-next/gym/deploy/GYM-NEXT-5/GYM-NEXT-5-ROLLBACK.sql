-- ============================================================
-- STEP GYM-NEXT-5 ROLLBACK
-- 入会・プラン履歴を削除せず、バックアップテーブルへ退避します。
--
-- 実行前にCloudflare Workerを
-- GYM-NEXT-4-WORKER-20260725へ戻してください。
-- ============================================================

begin;

drop function if exists public.gym_admit_customer_next(
  uuid, text, text, date, text, text, text
);

drop function if exists public.gym_record_trial_decision_next(
  uuid, text, uuid, text, text, date, text
);

drop function if exists public.gym_next_5_system_check(text);

drop index if exists public.gym_ticket_ledger_membership_grant_once_idx;

alter table public.gym_ticket_ledger
  drop constraint if exists gym_ticket_ledger_membership_fk;

do $$
begin
  if to_regclass('public.gym_trial_decisions') is not null
     and to_regclass(
       'public.gym_trial_decisions_next5_backup_20260725'
     ) is null then
    alter table public.gym_trial_decisions
      rename to gym_trial_decisions_next5_backup_20260725;
  end if;

  if to_regclass('public.gym_memberships') is not null
     and to_regclass(
       'public.gym_memberships_next5_backup_20260725'
     ) is null then
    alter table public.gym_memberships
      rename to gym_memberships_next5_backup_20260725;
  end if;

  if to_regclass('public.gym_plans') is not null
     and to_regclass(
       'public.gym_plans_next5_backup_20260725'
     ) is null then
    alter table public.gym_plans
      rename to gym_plans_next5_backup_20260725;
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
  'gym_next_5_rollback_applied',
  'system',
  'GYM-NEXT-5',
  jsonb_build_object(
    'plans_preserved', true,
    'memberships_preserved', true,
    'trial_decisions_preserved', true,
    'membership_id_column_preserved', true
  ),
  'rollback'
);

commit;

select jsonb_build_object(
  'ok', true,
  'rollback', 'GYM-NEXT-5',
  'plans_backup',
    to_regclass(
      'public.gym_plans_next5_backup_20260725'
    ) is not null,
  'memberships_backup',
    to_regclass(
      'public.gym_memberships_next5_backup_20260725'
    ) is not null,
  'trial_decisions_backup',
    to_regclass(
      'public.gym_trial_decisions_next5_backup_20260725'
    ) is not null
) as gym_next_5_rollback_result;
