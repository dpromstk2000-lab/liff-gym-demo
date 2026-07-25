-- ============================================================
-- STEP GYM-NEXT-4
-- DPRO パーソナルジム LINE
-- セッション記録・完了一体処理・回数券減算ガード強化
-- 2026-07-25
--
-- 既存のgym_テーブルを削除しません。
-- 既存gym_ticket_ledgerとgym_update_reservation_status_atomicを維持します。
-- 新規追加はgym_session_recordsとNEXT用RPCです。
-- ============================================================

begin;

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.gym_facilities') is null
     or to_regclass('public.gym_services') is null
     or to_regclass('public.gym_trainers') is null
     or to_regclass('public.gym_customers') is null
     or to_regclass('public.gym_reservations') is null
     or to_regclass('public.gym_ticket_ledger') is null
     or to_regclass('public.gym_activity_logs') is null then
    raise exception 'GYM_NEXT_4_BASE_TABLE_MISSING';
  end if;

  if to_regprocedure(
    'public.gym_update_reservation_status_atomic(uuid,text,text,text)'
  ) is null then
    raise exception 'GYM_NEXT_4_BASE_RPC_MISSING';
  end if;
end;
$$;

create table if not exists public.gym_session_records (
  id uuid primary key default gen_random_uuid(),
  facility_code text not null
    references public.gym_facilities(facility_code) on delete cascade,
  reservation_id uuid not null
    references public.gym_reservations(id) on delete cascade,
  customer_id uuid not null
    references public.gym_customers(id) on delete cascade,
  trainer_code text,
  performed_at timestamptz not null default now(),
  record_status text not null default 'draft'
    check (record_status in ('draft', 'completed')),
  condition_note text,
  training_summary text,
  trainer_note text,
  next_focus text,
  member_visible_comment text,
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_code, reservation_id),
  foreign key (facility_code, trainer_code)
    references public.gym_trainers(facility_code, trainer_code)
    on delete restrict,
  check (condition_note is null or char_length(condition_note) <= 2000),
  check (training_summary is null or char_length(training_summary) <= 5000),
  check (trainer_note is null or char_length(trainer_note) <= 5000),
  check (next_focus is null or char_length(next_focus) <= 2000),
  check (
    member_visible_comment is null
    or char_length(member_visible_comment) <= 2000
  )
);

create index if not exists gym_session_records_customer_idx
  on public.gym_session_records (
    facility_code, customer_id, performed_at desc
  );

create index if not exists gym_session_records_trainer_idx
  on public.gym_session_records (
    facility_code, trainer_code, performed_at desc
  );

drop trigger if exists gym_session_records_touch_updated_at
  on public.gym_session_records;

create trigger gym_session_records_touch_updated_at
before update on public.gym_session_records
for each row execute function public.gym_touch_updated_at();

alter table public.gym_session_records enable row level security;

revoke all on table public.gym_session_records
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.gym_session_records
  to service_role;

do $$
begin
  if exists (
    select 1
    from public.gym_ticket_ledger
    where reservation_id is not null
      and change_amount = -1
      and reason = 'セッション完了'
    group by facility_code, reservation_id
    having count(*) > 1
  ) then
    raise exception 'GYM_NEXT_4_DUPLICATE_COMPLETION_LEDGER_FOUND';
  end if;
end;
$$;

create unique index if not exists
  gym_ticket_ledger_completion_once_idx
on public.gym_ticket_ledger (facility_code, reservation_id)
where reservation_id is not null
  and change_amount = -1
  and reason = 'セッション完了';

create or replace function public.gym_assert_reservation_transition_next(
  p_current_status text,
  p_new_status text
)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_current_status = p_new_status then
    return;
  end if;

  if p_current_status = 'requested'
     and p_new_status in ('confirmed', 'cancelled') then
    return;
  end if;

  if p_current_status = 'confirmed'
     and p_new_status in (
       'arrived', 'no_show', 'change_requested',
       'cancel_requested', 'cancelled'
     ) then
    return;
  end if;

  if p_current_status = 'arrived'
     and p_new_status = 'in_session' then
    return;
  end if;

  if p_current_status = 'in_session'
     and p_new_status = 'completed' then
    return;
  end if;

  if p_current_status in ('change_requested', 'cancel_requested')
     and p_new_status in ('confirmed', 'cancelled') then
    return;
  end if;

  raise exception
    'GYM_INVALID_STATUS_TRANSITION:%->%',
    p_current_status,
    p_new_status;
end;
$$;

create or replace function public.gym_update_reservation_status_next(
  p_reservation_id uuid,
  p_facility_code text,
  p_new_status text,
  p_admin_note text default null,
  p_created_by text default 'admin'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation public.gym_reservations;
  v_result jsonb;
  v_idempotent boolean := false;
begin
  select *
  into v_reservation
  from public.gym_reservations
  where id = p_reservation_id
    and facility_code = p_facility_code
  for update;

  if not found then
    raise exception 'GYM_RESERVATION_NOT_FOUND';
  end if;

  perform public.gym_assert_reservation_transition_next(
    v_reservation.status,
    p_new_status
  );

  if v_reservation.status = p_new_status then
    v_idempotent := true;

    select jsonb_build_object(
      'reservation', to_jsonb(v_reservation),
      'customer', to_jsonb(c)
    )
    into v_result
    from public.gym_customers c
    where c.id = v_reservation.customer_id;
  else
    v_result := public.gym_update_reservation_status_atomic(
      p_reservation_id,
      p_new_status,
      p_admin_note,
      coalesce(nullif(trim(p_created_by), ''), 'admin')
    );
  end if;

  insert into public.gym_activity_logs (
    facility_code,
    action,
    target_type,
    target_id,
    detail,
    created_by
  ) values (
    p_facility_code,
    'next_reservation_status_changed',
    'reservation',
    p_reservation_id::text,
    jsonb_build_object(
      'from_status', v_reservation.status,
      'to_status', p_new_status,
      'idempotent', v_idempotent
    ),
    coalesce(nullif(trim(p_created_by), ''), 'admin')
  );

  return coalesce(v_result, '{}'::jsonb)
    || jsonb_build_object('idempotent', v_idempotent);
end;
$$;

create or replace function public.gym_upsert_session_record(
  p_reservation_id uuid,
  p_facility_code text,
  p_record_status text default 'draft',
  p_condition_note text default null,
  p_training_summary text default null,
  p_trainer_note text default null,
  p_next_focus text default null,
  p_member_visible_comment text default null,
  p_created_by text default 'admin'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation public.gym_reservations;
  v_record public.gym_session_records;
begin
  if p_record_status not in ('draft', 'completed') then
    raise exception 'GYM_INVALID_SESSION_RECORD_STATUS';
  end if;

  select *
  into v_reservation
  from public.gym_reservations
  where id = p_reservation_id
    and facility_code = p_facility_code;

  if not found then
    raise exception 'GYM_RESERVATION_NOT_FOUND';
  end if;

  if v_reservation.status not in ('in_session', 'completed') then
    raise exception
      'GYM_SESSION_RECORD_NOT_ALLOWED_FOR_STATUS:%',
      v_reservation.status;
  end if;

  insert into public.gym_session_records (
    facility_code,
    reservation_id,
    customer_id,
    trainer_code,
    performed_at,
    record_status,
    condition_note,
    training_summary,
    trainer_note,
    next_focus,
    member_visible_comment,
    created_by
  ) values (
    v_reservation.facility_code,
    v_reservation.id,
    v_reservation.customer_id,
    v_reservation.trainer_code,
    coalesce(v_reservation.completed_at, v_reservation.start_at, now()),
    p_record_status,
    nullif(trim(p_condition_note), ''),
    nullif(trim(p_training_summary), ''),
    nullif(trim(p_trainer_note), ''),
    nullif(trim(p_next_focus), ''),
    nullif(trim(p_member_visible_comment), ''),
    coalesce(nullif(trim(p_created_by), ''), 'admin')
  )
  on conflict (facility_code, reservation_id)
  do update set
    customer_id = excluded.customer_id,
    trainer_code = excluded.trainer_code,
    performed_at = excluded.performed_at,
    record_status = excluded.record_status,
    condition_note = excluded.condition_note,
    training_summary = excluded.training_summary,
    trainer_note = excluded.trainer_note,
    next_focus = excluded.next_focus,
    member_visible_comment = excluded.member_visible_comment,
    updated_at = now()
  returning * into v_record;

  insert into public.gym_activity_logs (
    facility_code,
    action,
    target_type,
    target_id,
    detail,
    created_by
  ) values (
    p_facility_code,
    'session_record_upserted',
    'session_record',
    v_record.id::text,
    jsonb_build_object(
      'reservation_id', v_record.reservation_id,
      'customer_id', v_record.customer_id,
      'record_status', v_record.record_status
    ),
    coalesce(nullif(trim(p_created_by), ''), 'admin')
  );

  return to_jsonb(v_record);
end;
$$;

create or replace function public.gym_complete_session_next(
  p_reservation_id uuid,
  p_facility_code text,
  p_condition_note text default null,
  p_training_summary text default null,
  p_trainer_note text default null,
  p_next_focus text default null,
  p_member_visible_comment text default null,
  p_created_by text default 'admin'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation public.gym_reservations;
  v_completion jsonb;
  v_session_record jsonb;
  v_idempotent boolean := false;
begin
  if nullif(trim(p_training_summary), '') is null then
    raise exception 'GYM_TRAINING_SUMMARY_REQUIRED';
  end if;

  select *
  into v_reservation
  from public.gym_reservations
  where id = p_reservation_id
    and facility_code = p_facility_code
  for update;

  if not found then
    raise exception 'GYM_RESERVATION_NOT_FOUND';
  end if;

  if v_reservation.status = 'completed' then
    v_idempotent := true;
  elsif v_reservation.status <> 'in_session' then
    raise exception
      'GYM_SESSION_COMPLETION_NOT_ALLOWED:%',
      v_reservation.status;
  end if;

  v_completion := public.gym_update_reservation_status_next(
    p_reservation_id,
    p_facility_code,
    'completed',
    null,
    coalesce(nullif(trim(p_created_by), ''), 'admin')
  );

  v_session_record := public.gym_upsert_session_record(
    p_reservation_id,
    p_facility_code,
    'completed',
    p_condition_note,
    p_training_summary,
    p_trainer_note,
    p_next_focus,
    p_member_visible_comment,
    coalesce(nullif(trim(p_created_by), ''), 'admin')
  );

  return coalesce(v_completion, '{}'::jsonb)
    || jsonb_build_object(
      'session_record', v_session_record,
      'idempotent', v_idempotent
    );
end;
$$;

create or replace function public.gym_next_4_system_check(
  p_facility_code text default 'dpro_gym_demo'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_count bigint;
  v_ledger_count bigint;
  v_duplicate_completion_count bigint;
begin
  select count(*)
  into v_session_count
  from public.gym_session_records
  where facility_code = p_facility_code;

  select count(*)
  into v_ledger_count
  from public.gym_ticket_ledger
  where facility_code = p_facility_code;

  select count(*)
  into v_duplicate_completion_count
  from (
    select reservation_id
    from public.gym_ticket_ledger
    where facility_code = p_facility_code
      and reservation_id is not null
      and change_amount = -1
      and reason = 'セッション完了'
    group by reservation_id
    having count(*) > 1
  ) duplicates;

  return jsonb_build_object(
    'ok', v_duplicate_completion_count = 0,
    'facility_code', p_facility_code,
    'session_records', true,
    'completion_guard', true,
    'ticket_completion_unique_guard', true,
    'session_record_count', v_session_count,
    'ticket_ledger_count', v_ledger_count,
    'duplicate_completion_count', v_duplicate_completion_count
  );
end;
$$;

revoke all on function public.gym_assert_reservation_transition_next(
  text, text
) from public, anon, authenticated;

revoke all on function public.gym_update_reservation_status_next(
  uuid, text, text, text, text
) from public, anon, authenticated;

revoke all on function public.gym_upsert_session_record(
  uuid, text, text, text, text, text, text, text, text
) from public, anon, authenticated;

revoke all on function public.gym_complete_session_next(
  uuid, text, text, text, text, text, text, text
) from public, anon, authenticated;

revoke all on function public.gym_next_4_system_check(
  text
) from public, anon, authenticated;

grant execute on function public.gym_assert_reservation_transition_next(
  text, text
) to service_role;

grant execute on function public.gym_update_reservation_status_next(
  uuid, text, text, text, text
) to service_role;

grant execute on function public.gym_upsert_session_record(
  uuid, text, text, text, text, text, text, text, text
) to service_role;

grant execute on function public.gym_complete_session_next(
  uuid, text, text, text, text, text, text, text
) to service_role;

grant execute on function public.gym_next_4_system_check(
  text
) to service_role;

insert into public.gym_activity_logs (
  facility_code,
  action,
  target_type,
  target_id,
  detail,
  created_by
) values (
  'dpro_gym_demo',
  'gym_next_4_migration_ready',
  'system',
  'GYM-NEXT-4',
  jsonb_build_object(
    'session_records', true,
    'completion_guard', true,
    'ticket_completion_unique_guard', true,
    'existing_ticket_ledger_preserved', true,
    'existing_atomic_status_rpc_preserved', true
  ),
  'migration'
);

commit;

select public.gym_next_4_system_check(
  'dpro_gym_demo'
) as gym_next_4_result;
