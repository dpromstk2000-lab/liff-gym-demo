-- ============================================================
-- STEP GYM-NEXT-5
-- DPRO パーソナルジム LINE
-- 体験・入会・プラン管理
-- 2026-07-25
--
-- 既存データを削除しません。
-- 既存の会員状態・plan_name・回数券台帳を維持しながら、
-- プランマスター、入会履歴、体験結果履歴を追加します。
-- ============================================================

begin;

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.gym_facilities') is null
     or to_regclass('public.gym_customers') is null
     or to_regclass('public.gym_reservations') is null
     or to_regclass('public.gym_services') is null
     or to_regclass('public.gym_ticket_ledger') is null
     or to_regclass('public.gym_activity_logs') is null then
    raise exception 'GYM_NEXT_5_BASE_TABLE_MISSING';
  end if;

  if to_regprocedure('public.gym_next_4_system_check(text)') is null then
    raise exception 'GYM_NEXT_5_REQUIRES_NEXT_4';
  end if;
end;
$$;

create table if not exists public.gym_plans (
  id uuid primary key default gen_random_uuid(),
  facility_code text not null
    references public.gym_facilities(facility_code) on delete cascade,
  plan_code text not null,
  plan_name text not null,
  plan_type text not null default 'ticket'
    check (plan_type in ('ticket', 'monthly', 'other')),
  included_sessions integer not null default 0
    check (included_sessions between 0 and 365),
  validity_days integer not null default 30
    check (validity_days between 1 and 730),
  price_yen integer
    check (price_yen is null or price_yen >= 0),
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_code, plan_code),
  check (char_length(plan_code) between 1 and 80),
  check (char_length(plan_name) between 1 and 200),
  check (description is null or char_length(description) <= 2000)
);

create index if not exists gym_plans_active_idx
  on public.gym_plans (facility_code, is_active, sort_order, plan_name);

drop trigger if exists gym_plans_touch_updated_at
  on public.gym_plans;

create trigger gym_plans_touch_updated_at
before update on public.gym_plans
for each row execute function public.gym_touch_updated_at();

create table if not exists public.gym_memberships (
  id uuid primary key default gen_random_uuid(),
  facility_code text not null
    references public.gym_facilities(facility_code) on delete cascade,
  customer_id uuid not null
    references public.gym_customers(id) on delete cascade,
  plan_code text not null,
  plan_name_snapshot text not null,
  plan_type_snapshot text not null
    check (plan_type_snapshot in ('ticket', 'monthly', 'other')),
  included_sessions integer not null default 0
    check (included_sessions between 0 and 365),
  started_on date not null,
  expires_on date not null,
  status text not null default 'active'
    check (status in ('active', 'ended', 'cancelled')),
  source text not null default 'trial'
    check (source in ('trial', 'manual', 'reactivation')),
  admission_note text,
  created_by text not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (facility_code, plan_code)
    references public.gym_plans(facility_code, plan_code)
    on update cascade on delete restrict,
  check (expires_on >= started_on),
  check (
    admission_note is null
    or char_length(admission_note) <= 3000
  )
);

create unique index if not exists gym_memberships_one_active_idx
  on public.gym_memberships (facility_code, customer_id)
  where status = 'active';

create index if not exists gym_memberships_customer_history_idx
  on public.gym_memberships (
    facility_code, customer_id, started_on desc, created_at desc
  );

drop trigger if exists gym_memberships_touch_updated_at
  on public.gym_memberships;

create trigger gym_memberships_touch_updated_at
before update on public.gym_memberships
for each row execute function public.gym_touch_updated_at();

create table if not exists public.gym_trial_decisions (
  id uuid primary key default gen_random_uuid(),
  facility_code text not null
    references public.gym_facilities(facility_code) on delete cascade,
  customer_id uuid not null
    references public.gym_customers(id) on delete cascade,
  reservation_id uuid
    references public.gym_reservations(id) on delete set null,
  decision text not null
    check (decision in ('considering', 'follow_up', 'declined', 'joined')),
  reason text,
  next_follow_on date,
  created_by text not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_code, reservation_id),
  check (reason is null or char_length(reason) <= 3000)
);

create index if not exists gym_trial_decisions_customer_idx
  on public.gym_trial_decisions (
    facility_code, customer_id, created_at desc
  );

drop trigger if exists gym_trial_decisions_touch_updated_at
  on public.gym_trial_decisions;

create trigger gym_trial_decisions_touch_updated_at
before update on public.gym_trial_decisions
for each row execute function public.gym_touch_updated_at();

alter table public.gym_ticket_ledger
  add column if not exists membership_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'gym_ticket_ledger_membership_fk'
      and conrelid = 'public.gym_ticket_ledger'::regclass
  ) then
    alter table public.gym_ticket_ledger
      add constraint gym_ticket_ledger_membership_fk
      foreign key (membership_id)
      references public.gym_memberships(id)
      on delete set null;
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.gym_ticket_ledger
    where membership_id is not null
      and change_amount > 0
    group by facility_code, membership_id
    having count(*) > 1
  ) then
    raise exception 'GYM_NEXT_5_DUPLICATE_MEMBERSHIP_GRANT_FOUND';
  end if;
end;
$$;

create unique index if not exists
  gym_ticket_ledger_membership_grant_once_idx
on public.gym_ticket_ledger (facility_code, membership_id)
where membership_id is not null
  and change_amount > 0;

alter table public.gym_plans enable row level security;
alter table public.gym_memberships enable row level security;
alter table public.gym_trial_decisions enable row level security;

revoke all on table public.gym_plans
  from public, anon, authenticated;
revoke all on table public.gym_memberships
  from public, anon, authenticated;
revoke all on table public.gym_trial_decisions
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.gym_plans to service_role;
grant select, insert, update, delete
  on table public.gym_memberships to service_role;
grant select, insert, update, delete
  on table public.gym_trial_decisions to service_role;

insert into public.gym_plans (
  facility_code,
  plan_code,
  plan_name,
  plan_type,
  included_sessions,
  validity_days,
  price_yen,
  description,
  is_active,
  sort_order
) values
  (
    'dpro_gym_demo',
    'monthly4',
    '月4回プラン',
    'monthly',
    4,
    35,
    null,
    'デモ用の月4回プランです。金額は店舗設定で登録してください。',
    true,
    10
  ),
  (
    'dpro_gym_demo',
    'monthly8',
    '月8回プラン',
    'monthly',
    8,
    35,
    null,
    'デモ用の月8回プランです。金額は店舗設定で登録してください。',
    true,
    20
  ),
  (
    'dpro_gym_demo',
    'ticket8',
    '回数券8回',
    'ticket',
    8,
    120,
    null,
    'デモ用の8回回数券です。金額は店舗設定で登録してください。',
    true,
    30
  )
on conflict (facility_code, plan_code)
do update set
  plan_name = excluded.plan_name,
  plan_type = excluded.plan_type,
  included_sessions = excluded.included_sessions,
  validity_days = excluded.validity_days,
  description = excluded.description,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();

create or replace function public.gym_record_trial_decision_next(
  p_customer_id uuid,
  p_facility_code text,
  p_reservation_id uuid default null,
  p_decision text default 'considering',
  p_reason text default null,
  p_next_follow_on date default null,
  p_created_by text default 'admin'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.gym_customers%rowtype;
  v_decision public.gym_trial_decisions%rowtype;
  v_follow_on date;
begin
  if p_decision not in ('considering', 'follow_up', 'declined') then
    raise exception 'GYM_INVALID_TRIAL_DECISION';
  end if;

  select *
  into v_customer
  from public.gym_customers
  where id = p_customer_id
    and facility_code = p_facility_code
  for update;

  if not found then
    raise exception 'GYM_CUSTOMER_NOT_FOUND';
  end if;

  if p_reservation_id is not null
     and not exists (
       select 1
       from public.gym_reservations
       where id = p_reservation_id
         and facility_code = p_facility_code
         and customer_id = p_customer_id
     ) then
    raise exception 'GYM_TRIAL_RESERVATION_NOT_FOUND';
  end if;

  if p_decision in ('considering', 'follow_up') then
    v_follow_on := coalesce(p_next_follow_on, current_date + 3);
  else
    v_follow_on := null;
  end if;

  if p_reservation_id is null then
    insert into public.gym_trial_decisions (
      facility_code,
      customer_id,
      reservation_id,
      decision,
      reason,
      next_follow_on,
      created_by
    ) values (
      p_facility_code,
      p_customer_id,
      null,
      p_decision,
      nullif(trim(p_reason), ''),
      v_follow_on,
      coalesce(nullif(trim(p_created_by), ''), 'admin')
    )
    returning * into v_decision;
  else
    insert into public.gym_trial_decisions (
      facility_code,
      customer_id,
      reservation_id,
      decision,
      reason,
      next_follow_on,
      created_by
    ) values (
      p_facility_code,
      p_customer_id,
      p_reservation_id,
      p_decision,
      nullif(trim(p_reason), ''),
      v_follow_on,
      coalesce(nullif(trim(p_created_by), ''), 'admin')
    )
    on conflict (facility_code, reservation_id)
    do update set
      customer_id = excluded.customer_id,
      decision = excluded.decision,
      reason = excluded.reason,
      next_follow_on = excluded.next_follow_on,
      created_by = excluded.created_by,
      updated_at = now()
    returning * into v_decision;
  end if;

  if p_decision in ('considering', 'follow_up') then
    update public.gym_customers
    set
      status = 'continuation',
      follow_status = 'scheduled',
      next_follow_on = v_follow_on
    where id = p_customer_id
    returning * into v_customer;
  else
    update public.gym_customers
    set
      status = 'inactive',
      follow_status = 'done',
      next_follow_on = null
    where id = p_customer_id
    returning * into v_customer;
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
    'trial_decision_recorded',
    'customer',
    p_customer_id::text,
    jsonb_build_object(
      'reservation_id', p_reservation_id,
      'decision', p_decision,
      'next_follow_on', v_follow_on
    ),
    coalesce(nullif(trim(p_created_by), ''), 'admin')
  );

  return jsonb_build_object(
    'decision', to_jsonb(v_decision),
    'customer', to_jsonb(v_customer)
  );
end;
$$;

create or replace function public.gym_admit_customer_next(
  p_customer_id uuid,
  p_facility_code text,
  p_plan_code text,
  p_started_on date default current_date,
  p_source text default 'trial',
  p_admission_note text default null,
  p_created_by text default 'admin'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.gym_customers%rowtype;
  v_plan public.gym_plans%rowtype;
  v_existing public.gym_memberships%rowtype;
  v_membership public.gym_memberships%rowtype;
  v_trial_decision public.gym_trial_decisions%rowtype;
  v_ledger public.gym_ticket_ledger%rowtype;
  v_started_on date;
  v_expires_on date;
  v_balance integer;
  v_idempotent boolean := false;
begin
  if p_source not in ('trial', 'manual', 'reactivation') then
    raise exception 'GYM_INVALID_MEMBERSHIP_SOURCE';
  end if;

  v_started_on := coalesce(p_started_on, current_date);

  select *
  into v_customer
  from public.gym_customers
  where id = p_customer_id
    and facility_code = p_facility_code
  for update;

  if not found then
    raise exception 'GYM_CUSTOMER_NOT_FOUND';
  end if;

  select *
  into v_plan
  from public.gym_plans
  where facility_code = p_facility_code
    and plan_code = p_plan_code
    and is_active = true;

  if not found then
    raise exception 'GYM_ACTIVE_PLAN_NOT_FOUND';
  end if;

  select *
  into v_existing
  from public.gym_memberships
  where facility_code = p_facility_code
    and customer_id = p_customer_id
    and status = 'active'
  for update;

  if found
     and v_existing.plan_code = v_plan.plan_code
     and v_existing.started_on = v_started_on then
    v_idempotent := true;

    select *
    into v_customer
    from public.gym_customers
    where id = p_customer_id;

    return jsonb_build_object(
      'idempotent', true,
      'customer', to_jsonb(v_customer),
      'plan', to_jsonb(v_plan),
      'membership', to_jsonb(v_existing),
      'ledger', null
    );
  end if;

  if found then
    update public.gym_memberships
    set
      status = 'ended',
      expires_on = greatest(
        started_on,
        least(expires_on, v_started_on - 1)
      ),
      updated_at = now()
    where id = v_existing.id;
  end if;

  v_expires_on :=
    v_started_on + greatest(v_plan.validity_days - 1, 0);

  insert into public.gym_memberships (
    facility_code,
    customer_id,
    plan_code,
    plan_name_snapshot,
    plan_type_snapshot,
    included_sessions,
    started_on,
    expires_on,
    status,
    source,
    admission_note,
    created_by
  ) values (
    p_facility_code,
    p_customer_id,
    v_plan.plan_code,
    v_plan.plan_name,
    v_plan.plan_type,
    v_plan.included_sessions,
    v_started_on,
    v_expires_on,
    'active',
    p_source,
    nullif(trim(p_admission_note), ''),
    coalesce(nullif(trim(p_created_by), ''), 'admin')
  )
  returning * into v_membership;

  v_balance :=
    greatest(coalesce(v_customer.ticket_remaining, 0), 0)
    + greatest(v_plan.included_sessions, 0);

  update public.gym_customers
  set
    status = 'member',
    plan_name = v_plan.plan_name,
    ticket_remaining = v_balance,
    ticket_expires_on = v_expires_on,
    follow_status = 'none',
    next_follow_on = null
  where id = p_customer_id
  returning * into v_customer;

  if v_plan.included_sessions > 0 then
    insert into public.gym_ticket_ledger (
      facility_code,
      customer_id,
      membership_id,
      change_amount,
      balance_after,
      reason,
      created_by
    ) values (
      p_facility_code,
      p_customer_id,
      v_membership.id,
      v_plan.included_sessions,
      v_balance,
      '入会・プラン開始：' || v_plan.plan_name,
      coalesce(nullif(trim(p_created_by), ''), 'admin')
    )
    returning * into v_ledger;
  end if;

  insert into public.gym_trial_decisions (
    facility_code,
    customer_id,
    reservation_id,
    decision,
    reason,
    next_follow_on,
    created_by
  ) values (
    p_facility_code,
    p_customer_id,
    null,
    'joined',
    nullif(trim(p_admission_note), ''),
    null,
    coalesce(nullif(trim(p_created_by), ''), 'admin')
  )
  returning * into v_trial_decision;

  insert into public.gym_activity_logs (
    facility_code,
    action,
    target_type,
    target_id,
    detail,
    created_by
  ) values (
    p_facility_code,
    'customer_admitted_to_plan',
    'customer',
    p_customer_id::text,
    jsonb_build_object(
      'membership_id', v_membership.id,
      'plan_code', v_plan.plan_code,
      'plan_name', v_plan.plan_name,
      'ticket_grant', v_plan.included_sessions,
      'balance_after', v_balance,
      'started_on', v_started_on,
      'expires_on', v_expires_on
    ),
    coalesce(nullif(trim(p_created_by), ''), 'admin')
  );

  return jsonb_build_object(
    'idempotent', v_idempotent,
    'customer', to_jsonb(v_customer),
    'plan', to_jsonb(v_plan),
    'membership', to_jsonb(v_membership),
    'ledger', case
      when v_plan.included_sessions > 0 then to_jsonb(v_ledger)
      else null
    end
  );
end;
$$;

create or replace function public.gym_next_5_system_check(
  p_facility_code text default 'dpro_gym_demo'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_count bigint;
  v_active_membership_count bigint;
  v_trial_decision_count bigint;
  v_duplicate_active_memberships bigint;
  v_duplicate_membership_grants bigint;
begin
  select count(*)
  into v_plan_count
  from public.gym_plans
  where facility_code = p_facility_code
    and is_active = true;

  select count(*)
  into v_active_membership_count
  from public.gym_memberships
  where facility_code = p_facility_code
    and status = 'active';

  select count(*)
  into v_trial_decision_count
  from public.gym_trial_decisions
  where facility_code = p_facility_code;

  select count(*)
  into v_duplicate_active_memberships
  from (
    select customer_id
    from public.gym_memberships
    where facility_code = p_facility_code
      and status = 'active'
    group by customer_id
    having count(*) > 1
  ) duplicates;

  select count(*)
  into v_duplicate_membership_grants
  from (
    select membership_id
    from public.gym_ticket_ledger
    where facility_code = p_facility_code
      and membership_id is not null
      and change_amount > 0
    group by membership_id
    having count(*) > 1
  ) duplicates;

  return jsonb_build_object(
    'ok',
      v_plan_count > 0
      and v_duplicate_active_memberships = 0
      and v_duplicate_membership_grants = 0,
    'facility_code', p_facility_code,
    'plan_master', true,
    'trial_pipeline', true,
    'atomic_admission', true,
    'membership_grant_guard', true,
    'active_plan_count', v_plan_count,
    'active_membership_count', v_active_membership_count,
    'trial_decision_count', v_trial_decision_count,
    'duplicate_active_memberships', v_duplicate_active_memberships,
    'duplicate_membership_grants', v_duplicate_membership_grants
  );
end;
$$;

revoke all on function public.gym_record_trial_decision_next(
  uuid, text, uuid, text, text, date, text
) from public, anon, authenticated;

revoke all on function public.gym_admit_customer_next(
  uuid, text, text, date, text, text, text
) from public, anon, authenticated;

revoke all on function public.gym_next_5_system_check(
  text
) from public, anon, authenticated;

grant execute on function public.gym_record_trial_decision_next(
  uuid, text, uuid, text, text, date, text
) to service_role;

grant execute on function public.gym_admit_customer_next(
  uuid, text, text, date, text, text, text
) to service_role;

grant execute on function public.gym_next_5_system_check(
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
  'gym_next_5_migration_ready',
  'system',
  'GYM-NEXT-5',
  jsonb_build_object(
    'plan_master', true,
    'trial_pipeline', true,
    'atomic_admission', true,
    'membership_grant_guard', true,
    'existing_customer_fields_preserved', true,
    'existing_ticket_ledger_preserved', true
  ),
  'migration'
);

commit;

select public.gym_next_5_system_check(
  'dpro_gym_demo'
) as gym_next_5_result;
