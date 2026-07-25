/* ============================================================
  STEP GYM-NEXT-5
  DPRO パーソナルジム LINE API
  Worker name: dpro-gym-line-api
  Worker version: GYM-NEXT-5-WORKER-20260725

  Cloudflare Secrets:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
    ADMIN_TOKEN                 デモは 1234

  Optional variables:
    DEMO_FACILITY_CODE          dpro_gym_demo
    PUBLIC_SITE_URL
    REQUIRE_LINE_AUTH           true（本番推奨）/ false
    ALLOW_DEMO_ADMIN_FALLBACK   false（通常は設定不要）
============================================================ */

const VERSION = 'GYM-NEXT-5-WORKER-20260725';
const SERVICE = 'DPRO Personal Gym LINE API';
const DEFAULT_FACILITY_CODE = 'dpro_gym_demo';
const DEMO_CONFIRM_TEXT = 'DEMOパーソナルジムだけ実行';
const JST = 'Asia/Tokyo';

const TABLES = {
  facilities: 'gym_facilities',
  settings: 'gym_facility_settings',
  services: 'gym_services',
  trainers: 'gym_trainers',
  trainerHours: 'gym_trainer_hours',
  customers: 'gym_customers',
  reservations: 'gym_reservations',
  ticketLedger: 'gym_ticket_ledger',
  sessionRecords: 'gym_session_records',
  plans: 'gym_plans',
  memberships: 'gym_memberships',
  trialDecisions: 'gym_trial_decisions',
  inquiries: 'gym_inquiries',
  interactionLogs: 'gym_interaction_logs',
  activityLogs: 'gym_activity_logs',
  legacyProfiles: 'gym_profiles',
  legacySettings: 'gym_settings'
};

const ACTIVE_RESERVATION_STATUSES = new Set([
  'requested', 'confirmed', 'arrived', 'in_session', 'completed',
  'change_requested', 'cancel_requested'
]);

const RESERVATION_STATUSES = new Set([
  ...ACTIVE_RESERVATION_STATUSES,
  'cancelled', 'no_show'
]);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Key, X-LIFF-Access-Token, X-Demo-Confirm',
  'Access-Control-Expose-Headers': 'Content-Type, X-DPRO-Worker-Version',
  'Access-Control-Max-Age': '86400'
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: responseHeaders()
      });
    }

    const url = new URL(request.url);
    const path = normalizePath(url.pathname);

    try {
      validateEnvironment(env);

      if ((path === '/' || path === '/api/health') && request.method === 'GET') {
        return json(await handleHealth(env));
      }

      if (path === '/api/public/facility' && request.method === 'GET') {
        return json(await handlePublicFacility(url, env));
      }

      if (path === '/api/public/services' && request.method === 'GET') {
        return json(await handlePublicServices(url, env));
      }

      if (path === '/api/public/trainers' && request.method === 'GET') {
        return json(await handlePublicTrainers(url, env));
      }

      if (path === '/api/public/availability' && request.method === 'GET') {
        return json(await handlePublicAvailability(url, env));
      }

      if (path === '/api/public/reservations' && request.method === 'POST') {
        return json(await handlePublicReservationCreate(request, env), 201);
      }

      if (path === '/api/member/home' && request.method === 'GET') {
        return json(await handleMemberHome(request, url, env));
      }

      if (path === '/api/member/reservations/cancel-request' && request.method === 'POST') {
        return json(await handleMemberReservationRequest(request, env, 'cancel_requested'));
      }

      if (path === '/api/member/reservations/change-request' && request.method === 'POST') {
        return json(await handleMemberReservationRequest(request, env, 'change_requested'));
      }

      if (path === '/api/member/inquiries' && request.method === 'POST') {
        return json(await handleMemberInquiryCreate(request, env), 201);
      }

      if (path.startsWith('/api/admin/')) {
        requireAdmin(request, env);

        if (path === '/api/admin/dashboard' && request.method === 'GET') {
          return json(await handleAdminDashboard(url, env));
        }

        if (path === '/api/admin/customers' && request.method === 'GET') {
          return json(await handleAdminCustomers(url, env));
        }

        if (path === '/api/admin/customers/upsert' && request.method === 'POST') {
          return json(await handleAdminCustomerUpsert(request, env));
        }

        if (path === '/api/admin/customers/tickets' && request.method === 'POST') {
          return json(await handleAdminTicketChange(request, env));
        }

        if (path === '/api/admin/reservations' && request.method === 'GET') {
          return json(await handleAdminReservations(url, env));
        }

        if (path === '/api/admin/reservations' && request.method === 'POST') {
          return json(await handleAdminReservationCreate(request, env), 201);
        }

        if (path === '/api/admin/reservations/status' && request.method === 'POST') {
          return json(await handleAdminReservationStatus(request, env));
        }

        // STEP GYM-NEXT-4: セッション記録・完了一体処理
        if (path === '/api/admin/sessions/complete' && request.method === 'POST') {
          return json(await handleAdminSessionComplete(request, env));
        }

        if (path === '/api/admin/session-records/upsert' && request.method === 'POST') {
          return json(await handleAdminSessionRecordUpsert(request, env));
        }

        if (path === '/api/admin/session-records' && request.method === 'GET') {
          return json(await handleAdminSessionRecords(url, env));
        }

        const sessionRecordsMatch = path.match(
          /^\/api\/admin\/customers\/([^/]+)\/session-records$/
        );
        if (sessionRecordsMatch && request.method === 'GET') {
          return json(await handleAdminCustomerSessionRecords(
            url,
            env,
            decodeURIComponent(sessionRecordsMatch[1])
          ));
        }

        const ticketLedgerMatch = path.match(
          /^\/api\/admin\/customers\/([^/]+)\/ticket-ledger$/
        );
        if (ticketLedgerMatch && request.method === 'GET') {
          return json(await handleAdminCustomerTicketLedger(
            url,
            env,
            decodeURIComponent(ticketLedgerMatch[1])
          ));
        }

        if (path === '/api/admin/next-4-system-check' && request.method === 'GET') {
          return json(await handleAdminNext4SystemCheck(url, env));
        }

        // STEP GYM-NEXT-5: 体験・入会・プラン管理
        if (path === '/api/admin/plans' && request.method === 'GET') {
          return json(await handleAdminPlans(url, env));
        }

        if (path === '/api/admin/plans/upsert' && request.method === 'POST') {
          return json(await handleAdminPlanUpsert(request, env));
        }

        if (path === '/api/admin/trial-pipeline' && request.method === 'GET') {
          return json(await handleAdminTrialPipeline(url, env));
        }

        if (path === '/api/admin/trial-decisions' && request.method === 'POST') {
          return json(await handleAdminTrialDecision(request, env));
        }

        if (path === '/api/admin/customers/admit' && request.method === 'POST') {
          return json(await handleAdminCustomerAdmit(request, env));
        }

        const membershipsMatch = path.match(
          /^\/api\/admin\/customers\/([^/]+)\/memberships$/
        );
        if (membershipsMatch && request.method === 'GET') {
          return json(await handleAdminCustomerMemberships(
            url,
            env,
            decodeURIComponent(membershipsMatch[1])
          ));
        }

        if (path === '/api/admin/next-5-system-check' && request.method === 'GET') {
          return json(await handleAdminNext5SystemCheck(url, env));
        }

        if (path === '/api/admin/inquiries' && request.method === 'GET') {
          return json(await handleAdminInquiries(url, env));
        }

        if (path === '/api/admin/inquiries/status' && request.method === 'POST') {
          return json(await handleAdminInquiryStatus(request, env));
        }

        if (path === '/api/admin/interactions' && request.method === 'POST') {
          return json(await handleAdminInteractionCreate(request, env), 201);
        }

        if (path === '/api/admin/settings' && request.method === 'GET') {
          return json(await handleAdminSettingsGet(url, env));
        }

        if (path === '/api/admin/settings' && request.method === 'PATCH') {
          return json(await handleAdminSettingsPatch(request, env));
        }

        if (path === '/api/admin/activity-logs' && request.method === 'GET') {
          return json(await handleAdminActivityLogs(url, env));
        }

        if (path === '/api/admin/phone-normalize-check' && request.method === 'GET') {
          return json(handlePhoneNormalizeCheck());
        }

        if (path === '/api/admin/demo-prepare' && request.method === 'POST') {
          return json(await handleAdminDemoPrepare(request, env));
        }

        if (path === '/api/admin/system-check' && request.method === 'GET') {
          return json(await handleAdminSystemCheck(url, env));
        }
      }

      throw new HttpError(404, 'NOT_FOUND', '指定されたAPIはありません。');
    } catch (error) {
      return errorResponse(error);
    }
  }
};

async function handleHealth(env) {
  const facilityCode = getDefaultFacilityCode(env);
  let database = { ok: false };
  let next4 = {
    ok: false,
    session_records: false,
    completion_guard: false,
    ticket_completion_unique_guard: false
  };
  let next5 = {
    ok: false,
    plan_master: false,
    trial_pipeline: false,
    atomic_admission: false,
    membership_grant_guard: false
  };

  try {
    const facility = await getFacility(env, facilityCode);
    const settings = await getSettings(env, facilityCode);
    database = {
      ok: true,
      facility_code: facilityCode,
      facility_name: facility?.facility_name || null,
      is_demo: Boolean(facility?.is_demo),
      production_guard: Boolean(facility?.production_guard),
      default_slot_minutes: Number(settings?.default_slot_minutes || 0)
    };
  } catch (error) {
    database = {
      ok: false,
      error: safeErrorMessage(error)
    };
  }

  try {
    next4 = await callRpc(env, 'gym_next_4_system_check', {
      p_facility_code: facilityCode
    });
  } catch (error) {
    next4 = {
      ok: false,
      error: safeErrorMessage(error),
      session_records: false,
      completion_guard: false,
      ticket_completion_unique_guard: false
    };
  }

  try {
    next5 = await callRpc(env, 'gym_next_5_system_check', {
      p_facility_code: facilityCode
    });
  } catch (error) {
    next5 = {
      ok: false,
      error: safeErrorMessage(error),
      plan_master: false,
      trial_pipeline: false,
      atomic_admission: false,
      membership_grant_guard: false
    };
  }

  return {
    ok: Boolean(database.ok && next4?.ok && next5?.ok),
    service: SERVICE,
    version: VERSION,
    time: new Date().toISOString(),
    jst_date: todayJst(),
    database,
    next4,
    next5,
    admin_token_configured: Boolean(env.ADMIN_TOKEN),
    features: {
      worker_mediated_storage: true,
      customer_reservation_separation: true,
      reservation_slot_minutes: 30,
      phone_normalization: true,
      atomic_overlap_guard: true,
      ticket_ledger: true,
      session_records: Boolean(next4?.session_records),
      atomic_session_completion: Boolean(next4?.completion_guard),
      ticket_completion_unique_guard: Boolean(
        next4?.ticket_completion_unique_guard
      ),
      plan_master: Boolean(next5?.plan_master),
      trial_pipeline: Boolean(next5?.trial_pipeline),
      atomic_admission: Boolean(next5?.atomic_admission),
      membership_grant_guard: Boolean(
        next5?.membership_grant_guard
      ),
      owner_pc: true,
      owner_ipad: true,
      member_page: true,
      system_check: true,
      demo_prepare: true
    }
  };
}

async function handlePublicFacility(url, env) {
  const facilityCode = getFacilityCode(url, env);
  const [facility, settings, services, trainers] = await Promise.all([
    getFacility(env, facilityCode),
    getSettings(env, facilityCode),
    listServices(env, facilityCode),
    listTrainers(env, facilityCode)
  ]);

  if (!facility?.is_active) {
    throw new HttpError(404, 'FACILITY_NOT_FOUND', '施設情報が見つかりません。');
  }

  return {
    ok: true,
    facility: publicFacility(facility),
    settings: publicSettings(settings),
    services,
    trainers,
    version: VERSION
  };
}

async function handlePublicServices(url, env) {
  const facilityCode = getFacilityCode(url, env);
  return {
    ok: true,
    facility_code: facilityCode,
    services: await listServices(env, facilityCode)
  };
}

async function handlePublicTrainers(url, env) {
  const facilityCode = getFacilityCode(url, env);
  return {
    ok: true,
    facility_code: facilityCode,
    trainers: await listTrainers(env, facilityCode)
  };
}

async function handlePublicAvailability(url, env) {
  const facilityCode = getFacilityCode(url, env);
  const date = clean(url.searchParams.get('date'));
  const serviceCode = clean(url.searchParams.get('service_code'));
  const trainerCode = clean(url.searchParams.get('trainer_code'));

  if (!isYmd(date)) {
    throw new HttpError(400, 'INVALID_DATE', '日付はYYYY-MM-DD形式で指定してください。');
  }
  if (!serviceCode) {
    throw new HttpError(400, 'SERVICE_REQUIRED', 'メニューを選択してください。');
  }

  const availability = await buildAvailability(env, {
    facilityCode,
    date,
    serviceCode,
    trainerCode
  });

  return {
    ok: true,
    facility_code: facilityCode,
    ...availability
  };
}

async function handlePublicReservationCreate(request, env) {
  const body = await readJson(request);
  const facilityCode = clean(body.facility_code) || getDefaultFacilityCode(env);
  const facility = await getFacility(env, facilityCode);

  if (!facility?.is_active) {
    throw new HttpError(404, 'FACILITY_NOT_FOUND', '施設情報が見つかりません。');
  }

  const fullName = cleanName(body.full_name || body.display_name);
  const phone = clean(body.phone);
  const phoneNormalized = normalizePhone(phone);
  const serviceCode = clean(body.service_code);
  const trainerCode = clean(body.trainer_code);
  const startAt = parseReservationStart(body.start_at || body.preferred_datetime);
  const customerMessage = cleanMultiline(body.customer_message || body.concern, 1000);

  if (!fullName) {
    throw new HttpError(400, 'FULL_NAME_REQUIRED', 'お名前を入力してください。');
  }
  if (!isValidPhone(phoneNormalized)) {
    throw new HttpError(400, 'INVALID_PHONE', '電話番号を正しく入力してください。');
  }
  if (!serviceCode) {
    throw new HttpError(400, 'SERVICE_REQUIRED', 'メニューを選択してください。');
  }

  const identity = await resolveLineIdentity(request, env, facility, body);
  const service = await getService(env, facilityCode, serviceCode);
  if (!service?.is_active) {
    throw new HttpError(400, 'SERVICE_NOT_AVAILABLE', '選択したメニューは現在予約できません。');
  }

  const settings = await getSettings(env, facilityCode);
  validateBookingWindow(startAt, settings);

  const customer = await findOrCreateCustomer(env, {
    facilityCode,
    lineUserId: identity?.userId || null,
    fullName,
    phone,
    phoneNormalized,
    goal: cleanMultiline(body.goal, 500),
    concern: cleanMultiline(body.concern, 1000),
    status: service.service_type === 'trial' ? 'trial' : 'member'
  });

  const endAt = addMinutes(startAt, Number(service.duration_minutes));
  const reservationNo = makeReservationNo();
  let reservation;

  try {
    reservation = await callRpc(env, 'gym_create_reservation_atomic', {
      p_facility_code: facilityCode,
      p_reservation_no: reservationNo,
      p_customer_id: customer.id,
      p_service_code: serviceCode,
      p_trainer_code: trainerCode || null,
      p_start_at: startAt.toISOString(),
      p_end_at: endAt.toISOString(),
      p_status: 'requested',
      p_channel: facility.is_demo && body.demo ? 'demo' : 'line',
      p_customer_message: customerMessage || null,
      p_admin_note: null
    });
  } catch (error) {
    throw translateReservationError(error);
  }

  await logActivity(env, facilityCode, 'reservation_created_public', 'reservation', reservation.id, {
    reservation_no: reservation.reservation_no,
    service_code: reservation.service_code,
    channel: reservation.channel
  }, 'public');

  return {
    ok: true,
    message: '予約希望を受け付けました。オーナー確認後に確定します。',
    facility: publicFacility(facility),
    customer: memberCustomer(customer, true),
    reservation: memberReservation(reservation),
    member_token: customer.public_token,
    version: VERSION
  };
}

async function handleMemberHome(request, url, env) {
  const facilityCode = getFacilityCode(url, env);
  const facility = await getFacility(env, facilityCode);
  const customer = await resolveMemberCustomer(request, env, facility, {
    facility_code: facilityCode,
    member_token: url.searchParams.get('member_token'),
    line_user_id: url.searchParams.get('line_user_id'),
    demo: url.searchParams.get('demo') === '1'
  });

  const [reservations, inquiries] = await Promise.all([
    selectRows(env, TABLES.reservations, {
      select: '*',
      facility_code: `eq.${facilityCode}`,
      customer_id: `eq.${customer.id}`,
      order: 'start_at.desc',
      limit: '30'
    }),
    selectRows(env, TABLES.inquiries, {
      select: 'id,inquiry_type,message,status,created_at,updated_at',
      facility_code: `eq.${facilityCode}`,
      customer_id: `eq.${customer.id}`,
      order: 'created_at.desc',
      limit: '20'
    })
  ]);

  const now = Date.now();
  const upcoming = reservations
    .filter(row => new Date(row.end_at).getTime() >= now && !['cancelled', 'no_show'].includes(row.status))
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
  const history = reservations
    .filter(row => !upcoming.some(item => item.id === row.id))
    .slice(0, 10);

  return {
    ok: true,
    facility: publicFacility(facility),
    customer: memberCustomer(customer, false),
    next_reservation: upcoming[0] ? memberReservation(upcoming[0]) : null,
    upcoming_reservations: upcoming.map(memberReservation),
    reservation_history: history.map(memberReservation),
    inquiries,
    version: VERSION
  };
}

async function handleMemberReservationRequest(request, env, requestStatus) {
  const body = await readJson(request);
  const facilityCode = clean(body.facility_code) || getDefaultFacilityCode(env);
  const facility = await getFacility(env, facilityCode);
  const customer = await resolveMemberCustomer(request, env, facility, body);
  const reservationId = clean(body.reservation_id);
  const reason = cleanMultiline(body.reason, 1000);

  if (!reservationId || !reason) {
    throw new HttpError(400, 'REQUEST_DETAIL_REQUIRED', '対象予約と理由を入力してください。');
  }

  const reservation = await selectOne(env, TABLES.reservations, {
    select: '*',
    id: `eq.${reservationId}`,
    facility_code: `eq.${facilityCode}`,
    customer_id: `eq.${customer.id}`
  });

  if (!reservation) {
    throw new HttpError(404, 'RESERVATION_NOT_FOUND', '対象の予約が見つかりません。');
  }
  if (['completed', 'cancelled', 'no_show'].includes(reservation.status)) {
    throw new HttpError(409, 'RESERVATION_NOT_CHANGEABLE', 'この予約は変更できません。');
  }

  const updated = await patchRows(env, TABLES.reservations, {
    id: `eq.${reservation.id}`,
    customer_id: `eq.${customer.id}`
  }, {
    status: requestStatus,
    cancel_reason: reason
  });

  await patchRows(env, TABLES.customers, { id: `eq.${customer.id}` }, {
    follow_status: 'needed',
    next_follow_on: todayJst()
  });

  await insertRows(env, TABLES.inquiries, [{
    facility_code: facilityCode,
    customer_id: customer.id,
    inquiry_type: 'reservation',
    message: `${requestStatus === 'cancel_requested' ? 'キャンセル' : '日時変更'}希望：${reason}`,
    status: 'open'
  }]);

  return {
    ok: true,
    message: requestStatus === 'cancel_requested'
      ? 'キャンセル希望を受け付けました。店舗からの連絡をお待ちください。'
      : '日時変更希望を受け付けました。店舗からの連絡をお待ちください。',
    reservation: memberReservation(updated[0] || reservation)
  };
}

async function handleMemberInquiryCreate(request, env) {
  const body = await readJson(request);
  const facilityCode = clean(body.facility_code) || getDefaultFacilityCode(env);
  const facility = await getFacility(env, facilityCode);
  const customer = await resolveMemberCustomer(request, env, facility, body);
  const inquiryType = ['general', 'reservation', 'health', 'continuation', 'other'].includes(body.inquiry_type)
    ? body.inquiry_type
    : 'general';
  const message = cleanMultiline(body.message, 2000);

  if (!message) {
    throw new HttpError(400, 'MESSAGE_REQUIRED', '相談内容を入力してください。');
  }

  const rows = await insertRows(env, TABLES.inquiries, [{
    facility_code: facilityCode,
    customer_id: customer.id,
    inquiry_type: inquiryType,
    message,
    status: 'open'
  }]);

  await patchRows(env, TABLES.customers, { id: `eq.${customer.id}` }, {
    follow_status: 'needed',
    next_follow_on: todayJst()
  });

  await logActivity(env, facilityCode, 'member_inquiry_created', 'inquiry', rows[0]?.id, {
    inquiry_type: inquiryType
  }, 'member');

  return {
    ok: true,
    message: '相談内容を受け付けました。',
    inquiry: rows[0]
  };
}

async function handleAdminDashboard(url, env) {
  const facilityCode = getFacilityCode(url, env);
  const date = clean(url.searchParams.get('date')) || todayJst();
  if (!isYmd(date)) throw new HttpError(400, 'INVALID_DATE', '日付が正しくありません。');

  const start = jstDateTime(date, '00:00');
  const end = addDays(start, 1);
  const [facility, settings, customers, reservations, inquiries] = await Promise.all([
    getFacility(env, facilityCode),
    getSettings(env, facilityCode),
    selectRows(env, TABLES.customers, {
      select: '*',
      facility_code: `eq.${facilityCode}`,
      order: 'updated_at.desc',
      limit: '500'
    }),
    selectRows(env, TABLES.reservations, {
      select: '*',
      facility_code: `eq.${facilityCode}`,
      start_at: `gte.${start.toISOString()}`,
      end_at: `lt.${end.toISOString()}`,
      order: 'start_at.asc',
      limit: '300'
    }),
    selectRows(env, TABLES.inquiries, {
      select: '*',
      facility_code: `eq.${facilityCode}`,
      status: 'neq.closed',
      order: 'created_at.desc',
      limit: '100'
    })
  ]);

  const customerMap = Object.fromEntries(customers.map(row => [row.id, row]));
  const pending = reservations.filter(row => row.status === 'requested');
  const activeToday = reservations.filter(row => !['cancelled', 'no_show'].includes(row.status));
  const followDue = customers.filter(row =>
    ['needed', 'scheduled'].includes(row.follow_status) &&
    (!row.next_follow_on || row.next_follow_on <= date)
  );
  const lowTickets = customers.filter(row => row.status === 'member' && Number(row.ticket_remaining) <= 1);

  return {
    ok: true,
    facility: publicFacility(facility),
    settings: publicSettings(settings),
    date,
    counts: {
      reservations: activeToday.length,
      pending: pending.length,
      open_inquiries: inquiries.length,
      follow_due: followDue.length,
      low_tickets: lowTickets.length,
      customers: customers.length
    },
    reservations: reservations.map(row => adminReservation(row, customerMap[row.customer_id])),
    priority_tasks: [
      ...pending.map(row => ({ type: 'reservation_pending', reservation: adminReservation(row, customerMap[row.customer_id]) })),
      ...inquiries.map(row => ({ type: 'inquiry', inquiry: row, customer: adminCustomer(customerMap[row.customer_id]) })),
      ...followDue.map(row => ({ type: 'follow_due', customer: adminCustomer(row) })),
      ...lowTickets.map(row => ({ type: 'low_tickets', customer: adminCustomer(row) }))
    ].slice(0, 100),
    version: VERSION
  };
}

async function handleAdminCustomers(url, env) {
  const facilityCode = getFacilityCode(url, env);
  const query = clean(url.searchParams.get('q'));
  const normalizedQuery = normalizePhone(query);
  const rows = await selectRows(env, TABLES.customers, {
    select: '*',
    facility_code: `eq.${facilityCode}`,
    order: 'updated_at.desc',
    limit: '500'
  });

  const needle = normalizeSearch(query);
  const filtered = query
    ? rows.filter(row => {
        const haystack = normalizeSearch(`${row.full_name || ''} ${row.full_name_kana || ''} ${row.customer_no || ''}`);
        return haystack.includes(needle) || (normalizedQuery && row.phone_normalized?.includes(normalizedQuery));
      })
    : rows;

  return {
    ok: true,
    facility_code: facilityCode,
    query,
    count: filtered.length,
    customers: filtered.slice(0, 200).map(adminCustomer)
  };
}

async function handleAdminCustomerUpsert(request, env) {
  const body = await readJson(request);
  const facilityCode = clean(body.facility_code) || getDefaultFacilityCode(env);
  const facility = await getFacility(env, facilityCode);
  if (!facility) throw new HttpError(404, 'FACILITY_NOT_FOUND', '施設が見つかりません。');

  let customer;
  if (body.customer_id) {
    customer = await selectOne(env, TABLES.customers, {
      select: '*',
      id: `eq.${clean(body.customer_id)}`,
      facility_code: `eq.${facilityCode}`
    });
    if (!customer) throw new HttpError(404, 'CUSTOMER_NOT_FOUND', '会員が見つかりません。');
  }

  const fullName = cleanName(body.full_name || customer?.full_name);
  const phone = clean(body.phone ?? customer?.phone);
  const phoneNormalized = phone ? normalizePhone(phone) : null;
  if (!fullName) throw new HttpError(400, 'FULL_NAME_REQUIRED', 'お名前を入力してください。');
  if (!customer && !phone) throw new HttpError(400, 'PHONE_REQUIRED', '新規会員は電話番号を入力してください。');
  if (phone && !isValidPhone(phoneNormalized)) {
    throw new HttpError(400, 'INVALID_PHONE', '電話番号を正しく入力してください。');
  }
  if (!customer && phoneNormalized) {
    const duplicate = await selectOne(env, TABLES.customers, {
      select: 'id,customer_no,full_name',
      facility_code: `eq.${facilityCode}`,
      phone_normalized: `eq.${phoneNormalized}`
    });
    if (duplicate) {
      throw new HttpError(409, 'CUSTOMER_ALREADY_EXISTS', `同じ電話番号の既存会員（${duplicate.customer_no} / ${duplicate.full_name}）が見つかりました。`);
    }
  }

  const payload = compactObject({
    full_name: fullName,
    full_name_kana: hasOwn(body, 'full_name_kana') ? (cleanName(body.full_name_kana) || null) : undefined,
    phone: phone || null,
    phone_normalized: phoneNormalized || null,
    status: validCustomerStatus(body.status) ? body.status : (customer?.status || 'trial'),
    plan_name: hasOwn(body, 'plan_name') ? (clean(body.plan_name) || null) : undefined,
    ticket_remaining: isFiniteNumber(body.ticket_remaining) ? Math.max(0, Number(body.ticket_remaining)) : undefined,
    ticket_expires_on: isYmd(body.ticket_expires_on) ? body.ticket_expires_on : (body.ticket_expires_on === null ? null : undefined),
    goal: hasOwn(body, 'goal') ? (cleanMultiline(body.goal, 1000) || null) : undefined,
    concern: hasOwn(body, 'concern') ? (cleanMultiline(body.concern, 1000) || null) : undefined,
    precautions: hasOwn(body, 'precautions') ? (cleanMultiline(body.precautions, 1000) || null) : undefined,
    owner_note: hasOwn(body, 'owner_note') ? (cleanMultiline(body.owner_note, 3000) || null) : undefined,
    follow_status: ['none', 'needed', 'scheduled', 'done'].includes(body.follow_status) ? body.follow_status : undefined,
    next_follow_on: isYmd(body.next_follow_on) ? body.next_follow_on : (body.next_follow_on === null ? null : undefined)
  });

  if (customer) {
    const rows = await patchRows(env, TABLES.customers, { id: `eq.${customer.id}` }, payload);
    customer = rows[0];
  } else {
    const rows = await insertRows(env, TABLES.customers, [{
      facility_code: facilityCode,
      customer_no: makeCustomerNo(),
      ...payload,
      full_name: fullName,
      status: payload.status || 'trial'
    }]);
    customer = rows[0];
  }

  await logActivity(env, facilityCode, 'admin_customer_upsert', 'customer', customer.id, {
    customer_no: customer.customer_no
  }, 'admin');

  return { ok: true, customer: adminCustomer(customer) };
}

async function handleAdminTicketChange(request, env) {
  const body = await readJson(request);
  const facilityCode = clean(body.facility_code) || getDefaultFacilityCode(env);
  const customerId = clean(body.customer_id);
  const changeAmount = Number(body.change_amount);
  const reason = clean(body.reason) || '管理画面で回数調整';

  if (!customerId || !Number.isInteger(changeAmount) || changeAmount === 0) {
    throw new HttpError(400, 'INVALID_TICKET_CHANGE', '会員と増減回数を正しく指定してください。');
  }

  const customer = await selectOne(env, TABLES.customers, {
    select: '*',
    id: `eq.${customerId}`,
    facility_code: `eq.${facilityCode}`
  });
  if (!customer) throw new HttpError(404, 'CUSTOMER_NOT_FOUND', '会員が見つかりません。');

  const nextBalance = Number(customer.ticket_remaining || 0) + changeAmount;
  if (nextBalance < 0) throw new HttpError(409, 'TICKET_BALANCE_NEGATIVE', '残り回数を0未満にはできません。');

  const updated = await patchRows(env, TABLES.customers, { id: `eq.${customer.id}` }, {
    ticket_remaining: nextBalance,
    follow_status: nextBalance <= 1 ? 'needed' : customer.follow_status,
    next_follow_on: nextBalance <= 1 ? todayJst() : customer.next_follow_on
  });

  const ledger = await insertRows(env, TABLES.ticketLedger, [{
    facility_code: facilityCode,
    customer_id: customer.id,
    change_amount: changeAmount,
    balance_after: nextBalance,
    reason,
    created_by: 'admin'
  }]);

  await logActivity(env, facilityCode, 'admin_ticket_change', 'customer', customer.id, {
    change_amount: changeAmount,
    balance_after: nextBalance
  }, 'admin');

  return {
    ok: true,
    customer: adminCustomer(updated[0]),
    ledger: ledger[0]
  };
}

async function handleAdminReservations(url, env) {
  const facilityCode = getFacilityCode(url, env);
  const from = clean(url.searchParams.get('date_from')) || todayJst();
  const to = clean(url.searchParams.get('date_to')) || from;
  const status = clean(url.searchParams.get('status'));
  if (!isYmd(from) || !isYmd(to)) throw new HttpError(400, 'INVALID_DATE', '日付が正しくありません。');

  const filters = {
    select: '*',
    facility_code: `eq.${facilityCode}`,
    start_at: `gte.${jstDateTime(from, '00:00').toISOString()}`,
    end_at: `lt.${addDays(jstDateTime(to, '00:00'), 1).toISOString()}`,
    order: 'start_at.asc',
    limit: '1000'
  };
  if (status && RESERVATION_STATUSES.has(status)) filters.status = `eq.${status}`;

  const reservations = await selectRows(env, TABLES.reservations, filters);
  const customers = await selectRows(env, TABLES.customers, {
    select: '*',
    facility_code: `eq.${facilityCode}`,
    limit: '1000'
  });
  const customerMap = Object.fromEntries(customers.map(row => [row.id, row]));

  return {
    ok: true,
    facility_code: facilityCode,
    date_from: from,
    date_to: to,
    count: reservations.length,
    reservations: reservations.map(row => adminReservation(row, customerMap[row.customer_id]))
  };
}

async function handleAdminReservationCreate(request, env) {
  const body = await readJson(request);
  const facilityCode = clean(body.facility_code) || getDefaultFacilityCode(env);
  const serviceCode = clean(body.service_code);
  const trainerCode = clean(body.trainer_code);
  const startAt = parseReservationStart(body.start_at);
  const channel = ['phone', 'store', 'admin', 'demo'].includes(body.channel) ? body.channel : 'admin';
  const service = await getService(env, facilityCode, serviceCode);

  if (!service?.is_active) throw new HttpError(400, 'SERVICE_NOT_AVAILABLE', 'メニューが見つかりません。');

  let customer;
  if (body.customer_id) {
    customer = await selectOne(env, TABLES.customers, {
      select: '*',
      id: `eq.${clean(body.customer_id)}`,
      facility_code: `eq.${facilityCode}`
    });
    if (!customer) throw new HttpError(404, 'CUSTOMER_NOT_FOUND', '会員が見つかりません。');
  } else {
    const fullName = cleanName(body.full_name);
    const phone = clean(body.phone);
    const phoneNormalized = normalizePhone(phone);
    if (!fullName || !isValidPhone(phoneNormalized)) {
      throw new HttpError(400, 'CUSTOMER_DETAIL_REQUIRED', '新規受付ではお名前と電話番号を入力してください。');
    }
    customer = await findOrCreateCustomer(env, {
      facilityCode,
      lineUserId: null,
      fullName,
      phone,
      phoneNormalized,
      goal: cleanMultiline(body.goal, 500),
      concern: cleanMultiline(body.concern, 1000),
      status: service.service_type === 'trial' ? 'trial' : 'member'
    });
  }

  const settings = await getSettings(env, facilityCode);
  validateBookingWindow(startAt, settings, true);
  const endAt = addMinutes(startAt, Number(service.duration_minutes));
  let reservation;

  try {
    reservation = await callRpc(env, 'gym_create_reservation_atomic', {
      p_facility_code: facilityCode,
      p_reservation_no: makeReservationNo(),
      p_customer_id: customer.id,
      p_service_code: serviceCode,
      p_trainer_code: trainerCode || null,
      p_start_at: startAt.toISOString(),
      p_end_at: endAt.toISOString(),
      p_status: body.confirmed === false ? 'requested' : 'confirmed',
      p_channel: channel,
      p_customer_message: cleanMultiline(body.customer_message, 1000) || null,
      p_admin_note: cleanMultiline(body.admin_note, 2000) || null
    });
  } catch (error) {
    throw translateReservationError(error);
  }

  await logActivity(env, facilityCode, 'admin_reservation_created', 'reservation', reservation.id, {
    reservation_no: reservation.reservation_no,
    channel
  }, 'admin');

  return {
    ok: true,
    customer: adminCustomer(customer),
    reservation: adminReservation(reservation, customer)
  };
}

async function handleAdminReservationStatus(request, env) {
  const body = await readJson(request);
  const facilityCode = clean(body.facility_code) || getDefaultFacilityCode(env);
  const reservationId = clean(body.reservation_id);
  const status = clean(body.status);
  if (!reservationId || !RESERVATION_STATUSES.has(status)) {
    throw new HttpError(400, 'INVALID_RESERVATION_STATUS', '予約と変更後ステータスを正しく指定してください。');
  }

  const current = await selectOne(env, TABLES.reservations, {
    select: 'id,facility_code',
    id: `eq.${reservationId}`,
    facility_code: `eq.${facilityCode}`
  });
  if (!current) throw new HttpError(404, 'RESERVATION_NOT_FOUND', '予約が見つかりません。');

  const result = await callRpc(env, 'gym_update_reservation_status_atomic', {
    p_reservation_id: reservationId,
    p_new_status: status,
    p_admin_note: cleanMultiline(body.admin_note, 2000) || null,
    p_created_by: clean(body.created_by) || 'admin'
  });

  await logActivity(env, facilityCode, 'admin_reservation_status_changed', 'reservation', reservationId, {
    status
  }, 'admin');

  return {
    ok: true,
    reservation: adminReservation(result.reservation, result.customer),
    customer: adminCustomer(result.customer)
  };
}

async function handleAdminSessionComplete(request, env) {
  const body = await readJson(request);
  const facilityCode = clean(body.facility_code) || getDefaultFacilityCode(env);
  const reservationId = clean(body.reservation_id);
  const trainingSummary = cleanMultiline(body.training_summary, 5000);

  if (!reservationId) {
    throw new HttpError(
      400,
      'RESERVATION_REQUIRED',
      '完了する予約を指定してください。'
    );
  }

  if (!trainingSummary) {
    throw new HttpError(
      400,
      'TRAINING_SUMMARY_REQUIRED',
      '実施したトレーニング内容を入力してください。'
    );
  }

  const result = await callRpc(env, 'gym_complete_session_next', {
    p_reservation_id: reservationId,
    p_facility_code: facilityCode,
    p_condition_note: cleanMultiline(body.condition_note, 2000) || null,
    p_training_summary: trainingSummary,
    p_trainer_note: cleanMultiline(body.trainer_note, 5000) || null,
    p_next_focus: cleanMultiline(body.next_focus, 2000) || null,
    p_member_visible_comment:
      cleanMultiline(body.member_visible_comment, 2000) || null,
    p_created_by: clean(body.created_by) || 'admin'
  });

  await logActivity(
    env,
    facilityCode,
    'admin_session_completed_next',
    'reservation',
    reservationId,
    {
      idempotent: Boolean(result?.idempotent),
      session_record_id: result?.session_record?.id || null
    },
    clean(body.created_by) || 'admin'
  );

  return {
    ok: true,
    reservation: adminReservation(result?.reservation, result?.customer),
    customer: adminCustomer(result?.customer),
    session_record: adminSessionRecord(result?.session_record),
    idempotent: Boolean(result?.idempotent),
    version: VERSION
  };
}

async function handleAdminSessionRecordUpsert(request, env) {
  const body = await readJson(request);
  const facilityCode = clean(body.facility_code) || getDefaultFacilityCode(env);
  const reservationId = clean(body.reservation_id);
  const recordStatus = body.record_status === 'completed'
    ? 'completed'
    : 'draft';

  if (!reservationId) {
    throw new HttpError(
      400,
      'RESERVATION_REQUIRED',
      '記録対象の予約を指定してください。'
    );
  }

  const result = await callRpc(env, 'gym_upsert_session_record', {
    p_reservation_id: reservationId,
    p_facility_code: facilityCode,
    p_record_status: recordStatus,
    p_condition_note: cleanMultiline(body.condition_note, 2000) || null,
    p_training_summary:
      cleanMultiline(body.training_summary, 5000) || null,
    p_trainer_note: cleanMultiline(body.trainer_note, 5000) || null,
    p_next_focus: cleanMultiline(body.next_focus, 2000) || null,
    p_member_visible_comment:
      cleanMultiline(body.member_visible_comment, 2000) || null,
    p_created_by: clean(body.created_by) || 'admin'
  });

  return {
    ok: true,
    session_record: adminSessionRecord(result),
    version: VERSION
  };
}

async function handleAdminSessionRecords(url, env) {
  const facilityCode = getFacilityCode(url, env);
  const filters = {
    select: '*',
    facility_code: `eq.${facilityCode}`,
    order: 'performed_at.desc',
    limit: String(
      Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 20)))
    )
  };

  const customerId = clean(url.searchParams.get('customer_id'));
  const reservationId = clean(url.searchParams.get('reservation_id'));

  if (customerId) filters.customer_id = `eq.${customerId}`;
  if (reservationId) filters.reservation_id = `eq.${reservationId}`;

  const rows = await selectRows(env, TABLES.sessionRecords, filters);

  return {
    ok: true,
    facility_code: facilityCode,
    count: rows.length,
    session_records: rows.map(adminSessionRecord),
    version: VERSION
  };
}

async function handleAdminCustomerSessionRecords(url, env, customerId) {
  if (!customerId) {
    throw new HttpError(
      400,
      'CUSTOMER_REQUIRED',
      '会員を指定してください。'
    );
  }

  const copiedUrl = new URL(url.toString());
  copiedUrl.searchParams.set('customer_id', customerId);
  return handleAdminSessionRecords(copiedUrl, env);
}

async function handleAdminCustomerTicketLedger(url, env, customerId) {
  const facilityCode = getFacilityCode(url, env);

  if (!customerId) {
    throw new HttpError(
      400,
      'CUSTOMER_REQUIRED',
      '会員を指定してください。'
    );
  }

  const rows = await selectRows(env, TABLES.ticketLedger, {
    select:
      'id,facility_code,customer_id,reservation_id,change_amount,' +
      'balance_after,reason,created_by,created_at',
    facility_code: `eq.${facilityCode}`,
    customer_id: `eq.${customerId}`,
    order: 'created_at.desc',
    limit: String(
      Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 30)))
    )
  });

  return {
    ok: true,
    facility_code: facilityCode,
    customer_id: customerId,
    count: rows.length,
    ticket_ledger: rows,
    version: VERSION
  };
}

async function handleAdminNext4SystemCheck(url, env) {
  const facilityCode = getFacilityCode(url, env);
  const result = await callRpc(env, 'gym_next_4_system_check', {
    p_facility_code: facilityCode
  });

  return {
    ok: Boolean(result?.ok),
    facility_code: facilityCode,
    result,
    version: VERSION
  };
}

async function handleAdminPlans(url, env) {
  const facilityCode = getFacilityCode(url, env);
  const includeInactive =
    url.searchParams.get('include_inactive') === '1';

  const filters = {
    select: '*',
    facility_code: `eq.${facilityCode}`,
    order: 'sort_order.asc,plan_name.asc',
    limit: '200'
  };
  if (!includeInactive) filters.is_active = 'eq.true';

  const rows = await selectRows(env, TABLES.plans, filters);

  return {
    ok: true,
    facility_code: facilityCode,
    count: rows.length,
    plans: rows.map(adminPlan),
    version: VERSION
  };
}

async function handleAdminPlanUpsert(request, env) {
  const body = await readJson(request);
  const facilityCode =
    clean(body.facility_code) || getDefaultFacilityCode(env);
  const planCode = clean(body.plan_code);
  const planName = clean(body.plan_name);
  const planType = ['ticket', 'monthly', 'other'].includes(body.plan_type)
    ? body.plan_type
    : 'ticket';
  const includedSessions = Number(body.included_sessions);
  const validityDays = Number(body.validity_days);
  const priceYen =
    body.price_yen === null || body.price_yen === ''
      ? null
      : Number(body.price_yen);

  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(planCode)) {
    throw new HttpError(
      400,
      'INVALID_PLAN_CODE',
      'プランコードは英数字・ハイフン・アンダーバーで入力してください。'
    );
  }
  if (!planName) {
    throw new HttpError(
      400,
      'PLAN_NAME_REQUIRED',
      'プラン名を入力してください。'
    );
  }
  if (
    !Number.isInteger(includedSessions) ||
    includedSessions < 0 ||
    includedSessions > 365
  ) {
    throw new HttpError(
      400,
      'INVALID_INCLUDED_SESSIONS',
      '付与回数は0～365回で入力してください。'
    );
  }
  if (
    !Number.isInteger(validityDays) ||
    validityDays < 1 ||
    validityDays > 730
  ) {
    throw new HttpError(
      400,
      'INVALID_VALIDITY_DAYS',
      '有効日数は1～730日で入力してください。'
    );
  }
  if (
    priceYen !== null &&
    (!Number.isInteger(priceYen) || priceYen < 0)
  ) {
    throw new HttpError(
      400,
      'INVALID_PLAN_PRICE',
      '料金は0円以上の整数で入力してください。'
    );
  }

  const rows = await insertRows(env, TABLES.plans, [{
    facility_code: facilityCode,
    plan_code: planCode,
    plan_name: planName,
    plan_type: planType,
    included_sessions: includedSessions,
    validity_days: validityDays,
    price_yen: priceYen,
    description: cleanMultiline(body.description, 2000) || null,
    is_active: body.is_active !== false,
    sort_order: Number.isInteger(Number(body.sort_order))
      ? Number(body.sort_order)
      : 100
  }], 'facility_code,plan_code');

  await logActivity(
    env,
    facilityCode,
    'admin_plan_upsert',
    'plan',
    planCode,
    {
      plan_name: planName,
      included_sessions: includedSessions,
      validity_days: validityDays
    },
    clean(body.created_by) || 'admin'
  );

  return {
    ok: true,
    plan: adminPlan(rows[0]),
    version: VERSION
  };
}

async function handleAdminTrialPipeline(url, env) {
  const facilityCode = getFacilityCode(url, env);

  const [customers, services, reservations, decisions, plans] =
    await Promise.all([
      selectRows(env, TABLES.customers, {
        select: '*',
        facility_code: `eq.${facilityCode}`,
        status: 'in.(trial,continuation)',
        order: 'updated_at.desc',
        limit: '500'
      }),
      selectRows(env, TABLES.services, {
        select: 'service_code,service_name,service_type',
        facility_code: `eq.${facilityCode}`,
        service_type: 'eq.trial',
        limit: '100'
      }),
      selectRows(env, TABLES.reservations, {
        select: '*',
        facility_code: `eq.${facilityCode}`,
        order: 'start_at.desc',
        limit: '1000'
      }),
      selectRows(env, TABLES.trialDecisions, {
        select: '*',
        facility_code: `eq.${facilityCode}`,
        order: 'created_at.desc',
        limit: '1000'
      }),
      selectRows(env, TABLES.plans, {
        select: '*',
        facility_code: `eq.${facilityCode}`,
        is_active: 'eq.true',
        order: 'sort_order.asc,plan_name.asc',
        limit: '200'
      })
    ]);

  const trialServiceCodes = new Set(
    services.map(item => item.service_code)
  );
  const customerIds = new Set(customers.map(item => item.id));
  const latestReservation = new Map();
  const latestDecision = new Map();

  reservations.forEach(reservation => {
    if (
      customerIds.has(reservation.customer_id) &&
      trialServiceCodes.has(reservation.service_code) &&
      !latestReservation.has(reservation.customer_id)
    ) {
      latestReservation.set(
        reservation.customer_id,
        reservation
      );
    }
  });

  decisions.forEach(decision => {
    if (
      customerIds.has(decision.customer_id) &&
      !latestDecision.has(decision.customer_id)
    ) {
      latestDecision.set(decision.customer_id, decision);
    }
  });

  const today = todayJst();
  const pipeline = customers.map(customer => ({
    customer: adminCustomer(customer),
    latest_trial_reservation:
      latestReservation.get(customer.id)
        ? adminReservation(
            latestReservation.get(customer.id),
            customer
          )
        : null,
    latest_decision:
      latestDecision.get(customer.id) || null
  }));

  return {
    ok: true,
    facility_code: facilityCode,
    counts: {
      total: pipeline.length,
      trial: customers.filter(item => item.status === 'trial').length,
      considering:
        customers.filter(item => item.status === 'continuation').length,
      follow_due:
        customers.filter(item =>
          item.status === 'continuation' &&
          (!item.next_follow_on || item.next_follow_on <= today)
        ).length
    },
    trial_services: services,
    plans: plans.map(adminPlan),
    pipeline,
    version: VERSION
  };
}

async function handleAdminTrialDecision(request, env) {
  const body = await readJson(request);
  const facilityCode =
    clean(body.facility_code) || getDefaultFacilityCode(env);
  const customerId = clean(body.customer_id);
  const reservationId = clean(body.reservation_id) || null;
  const decision = ['considering', 'follow_up', 'declined'].includes(
    body.decision
  )
    ? body.decision
    : '';

  if (!customerId || !decision) {
    throw new HttpError(
      400,
      'TRIAL_DECISION_REQUIRED',
      '体験者と結果を正しく指定してください。'
    );
  }

  const result = await callRpc(
    env,
    'gym_record_trial_decision_next',
    {
      p_customer_id: customerId,
      p_facility_code: facilityCode,
      p_reservation_id: reservationId,
      p_decision: decision,
      p_reason: cleanMultiline(body.reason, 3000) || null,
      p_next_follow_on:
        isYmd(body.next_follow_on)
          ? body.next_follow_on
          : null,
      p_created_by: clean(body.created_by) || 'admin'
    }
  );

  return {
    ok: true,
    decision: result?.decision || null,
    customer: adminCustomer(result?.customer),
    version: VERSION
  };
}

async function handleAdminCustomerAdmit(request, env) {
  const body = await readJson(request);
  const facilityCode =
    clean(body.facility_code) || getDefaultFacilityCode(env);
  const customerId = clean(body.customer_id);
  const planCode = clean(body.plan_code);
  const startedOn =
    isYmd(body.started_on)
      ? body.started_on
      : todayJst();
  const source = ['trial', 'manual', 'reactivation'].includes(
    body.source
  )
    ? body.source
    : 'trial';

  if (!customerId || !planCode) {
    throw new HttpError(
      400,
      'ADMISSION_DETAIL_REQUIRED',
      '体験者と入会プランを選択してください。'
    );
  }

  const result = await callRpc(env, 'gym_admit_customer_next', {
    p_customer_id: customerId,
    p_facility_code: facilityCode,
    p_plan_code: planCode,
    p_started_on: startedOn,
    p_source: source,
    p_admission_note:
      cleanMultiline(body.admission_note, 3000) || null,
    p_created_by: clean(body.created_by) || 'admin'
  });

  return {
    ok: true,
    idempotent: Boolean(result?.idempotent),
    customer: adminCustomer(result?.customer),
    plan: adminPlan(result?.plan),
    membership: adminMembership(result?.membership),
    ledger: result?.ledger || null,
    version: VERSION
  };
}

async function handleAdminCustomerMemberships(
  url,
  env,
  customerId
) {
  const facilityCode = getFacilityCode(url, env);

  if (!customerId) {
    throw new HttpError(
      400,
      'CUSTOMER_REQUIRED',
      '会員を指定してください。'
    );
  }

  const rows = await selectRows(env, TABLES.memberships, {
    select: '*',
    facility_code: `eq.${facilityCode}`,
    customer_id: `eq.${customerId}`,
    order: 'started_on.desc,created_at.desc',
    limit: String(
      Math.min(
        100,
        Math.max(1, Number(url.searchParams.get('limit') || 30))
      )
    )
  });

  return {
    ok: true,
    facility_code: facilityCode,
    customer_id: customerId,
    count: rows.length,
    memberships: rows.map(adminMembership),
    version: VERSION
  };
}

async function handleAdminNext5SystemCheck(url, env) {
  const facilityCode = getFacilityCode(url, env);
  const result = await callRpc(env, 'gym_next_5_system_check', {
    p_facility_code: facilityCode
  });

  return {
    ok: Boolean(result?.ok),
    facility_code: facilityCode,
    result,
    version: VERSION
  };
}

async function handleAdminInquiries(url, env) {
  const facilityCode = getFacilityCode(url, env);
  const status = clean(url.searchParams.get('status'));
  const filters = {
    select: '*',
    facility_code: `eq.${facilityCode}`,
    order: 'created_at.desc',
    limit: '300'
  };
  if (['open', 'in_progress', 'closed'].includes(status)) filters.status = `eq.${status}`;

  const inquiries = await selectRows(env, TABLES.inquiries, filters);
  const customers = await selectRows(env, TABLES.customers, {
    select: '*', facility_code: `eq.${facilityCode}`, limit: '1000'
  });
  const customerMap = Object.fromEntries(customers.map(row => [row.id, row]));

  return {
    ok: true,
    count: inquiries.length,
    inquiries: inquiries.map(row => ({ ...row, customer: adminCustomer(customerMap[row.customer_id]) }))
  };
}

async function handleAdminInquiryStatus(request, env) {
  const body = await readJson(request);
  const facilityCode = clean(body.facility_code) || getDefaultFacilityCode(env);
  const inquiryId = clean(body.inquiry_id);
  const status = clean(body.status);
  if (!inquiryId || !['open', 'in_progress', 'closed'].includes(status)) {
    throw new HttpError(400, 'INVALID_INQUIRY_STATUS', '相談とステータスを正しく指定してください。');
  }

  const rows = await patchRows(env, TABLES.inquiries, {
    id: `eq.${inquiryId}`,
    facility_code: `eq.${facilityCode}`
  }, {
    status,
    admin_reply_note: cleanMultiline(body.admin_reply_note, 2000) || null
  });
  if (!rows.length) throw new HttpError(404, 'INQUIRY_NOT_FOUND', '相談が見つかりません。');

  await logActivity(env, facilityCode, 'admin_inquiry_status_changed', 'inquiry', inquiryId, { status }, 'admin');
  return { ok: true, inquiry: rows[0] };
}

async function handleAdminInteractionCreate(request, env) {
  const body = await readJson(request);
  const facilityCode = clean(body.facility_code) || getDefaultFacilityCode(env);
  const title = clean(body.title);
  if (!title) throw new HttpError(400, 'TITLE_REQUIRED', '対応履歴のタイトルを入力してください。');

  const rows = await insertRows(env, TABLES.interactionLogs, [{
    facility_code: facilityCode,
    customer_id: clean(body.customer_id) || null,
    reservation_id: clean(body.reservation_id) || null,
    interaction_type: clean(body.interaction_type) || 'note',
    title,
    message_body: cleanMultiline(body.message_body, 5000) || null,
    status: clean(body.status) || 'recorded',
    owner_note: cleanMultiline(body.owner_note, 2000) || null,
    created_by: clean(body.created_by) || 'admin'
  }]);

  return { ok: true, interaction: rows[0] };
}

async function handleAdminSettingsGet(url, env) {
  const facilityCode = getFacilityCode(url, env);
  const [facility, settings, services, trainers, trainerHours] = await Promise.all([
    getFacility(env, facilityCode),
    getSettings(env, facilityCode),
    listServices(env, facilityCode, false),
    listTrainers(env, facilityCode, false),
    selectRows(env, TABLES.trainerHours, {
      select: '*', facility_code: `eq.${facilityCode}`, order: 'trainer_code.asc,day_of_week.asc'
    })
  ]);

  return { ok: true, facility, settings, services, trainers, trainer_hours: trainerHours };
}

async function handleAdminSettingsPatch(request, env) {
  const body = await readJson(request);
  const facilityCode = clean(body.facility_code) || getDefaultFacilityCode(env);
  const payload = compactObject({
    open_time: isHm(body.open_time) ? body.open_time : undefined,
    close_time: isHm(body.close_time) ? body.close_time : undefined,
    default_slot_minutes: body.default_slot_minutes === 30 ? 30 : undefined,
    max_booking_days: integerBetween(body.max_booking_days, 1, 365),
    min_lead_hours: integerBetween(body.min_lead_hours, 0, 168),
    cancellation_deadline_hours: integerBetween(body.cancellation_deadline_hours, 0, 336),
    max_parallel_sessions: integerBetween(body.max_parallel_sessions, 1, 20),
    weekly_closed_days: validWeekdays(body.weekly_closed_days) ? body.weekly_closed_days : undefined,
    special_closed_dates: validDateArray(body.special_closed_dates) ? body.special_closed_dates : undefined,
    booking_notice: typeof body.booking_notice === 'string' ? cleanMultiline(body.booking_notice, 1000) : undefined
  });

  if (payload.open_time && payload.close_time && payload.open_time >= payload.close_time) {
    throw new HttpError(400, 'INVALID_OPEN_HOURS', '営業終了時間は開始時間より後にしてください。');
  }

  const rows = await patchRows(env, TABLES.settings, {
    facility_code: `eq.${facilityCode}`
  }, payload);
  if (!rows.length) throw new HttpError(404, 'SETTINGS_NOT_FOUND', '施設設定が見つかりません。');

  await logActivity(env, facilityCode, 'admin_settings_updated', 'settings', facilityCode, {
    changed_keys: Object.keys(payload)
  }, 'admin');

  return { ok: true, settings: rows[0] };
}

async function handleAdminActivityLogs(url, env) {
  const facilityCode = getFacilityCode(url, env);
  const rows = await selectRows(env, TABLES.activityLogs, {
    select: '*',
    facility_code: `eq.${facilityCode}`,
    order: 'created_at.desc',
    limit: String(Math.min(300, Math.max(1, Number(url.searchParams.get('limit') || 100))))
  });
  return { ok: true, count: rows.length, activity_logs: rows };
}

function handlePhoneNormalizeCheck() {
  const samples = [
    '090-1111-2222',
    '09011112222',
    '090 1111 2222',
    '０９０ー１１１１ー２２２２',
    '+81 90-1111-2222'
  ];
  const normalized = samples.map(input => ({ input, normalized: normalizePhone(input) }));
  const values = [...new Set(normalized.map(item => item.normalized))];
  return {
    ok: values.length === 1 && values[0] === '09011112222',
    expected: '09011112222',
    normalized,
    version: VERSION
  };
}

async function handleAdminDemoPrepare(request, env) {
  const body = await readJson(request);
  const facilityCode = clean(body.facility_code) || getDefaultFacilityCode(env);
  const facility = await getFacility(env, facilityCode);
  const confirmText = request.headers.get('x-demo-confirm') || body.confirm_text;

  if (!facility?.is_demo || facilityCode !== getDefaultFacilityCode(env)) {
    throw new HttpError(403, 'PRODUCTION_GUARD', 'デモ施設以外では営業前デモ準備を実行できません。');
  }
  if (confirmText !== DEMO_CONFIRM_TEXT) {
    throw new HttpError(400, 'DEMO_CONFIRM_REQUIRED', `確認文言「${DEMO_CONFIRM_TEXT}」が必要です。`);
  }

  await deleteRows(env, TABLES.inquiries, { facility_code: `eq.${facilityCode}` });
  await deleteRows(env, TABLES.interactionLogs, { facility_code: `eq.${facilityCode}` });
  await deleteRows(env, TABLES.trialDecisions, { facility_code: `eq.${facilityCode}` });
  await deleteRows(env, TABLES.memberships, { facility_code: `eq.${facilityCode}` });
  await deleteRows(env, TABLES.ticketLedger, { facility_code: `eq.${facilityCode}` });
  await deleteRows(env, TABLES.reservations, { facility_code: `eq.${facilityCode}` });
  await deleteRows(env, TABLES.customers, { facility_code: `eq.${facilityCode}` });
  await deleteRows(env, TABLES.activityLogs, { facility_code: `eq.${facilityCode}` });

  const today = todayJst();
  const nextOpen = nextBusinessDate(today, 1);
  const secondOpen = nextBusinessDate(nextOpen, 1);
  const thirdOpen = nextBusinessDate(secondOpen, 1);

  const customers = await insertRows(env, TABLES.customers, [
    {
      facility_code: facilityCode,
      customer_no: 'GYM-DEMO-001',
      line_user_id: 'demo_gym_line_001',
      full_name: '田中 美咲',
      phone: '090-1111-2201',
      phone_normalized: '09011112201',
      status: 'trial',
      ticket_remaining: 0,
      goal: '3か月で無理なく引き締めたい',
      concern: '運動が続かなかった経験がある',
      follow_status: 'needed',
      next_follow_on: today
    },
    {
      facility_code: facilityCode,
      customer_no: 'GYM-DEMO-002',
      line_user_id: 'demo_gym_line_002',
      full_name: '佐藤 健太',
      phone: '090-1111-2202',
      phone_normalized: '09011112202',
      status: 'member',
      plan_name: '月8回プラン',
      ticket_remaining: 6,
      ticket_expires_on: addDaysYmd(today, 45),
      visit_count: 9,
      last_visit_on: addDaysYmd(today, -4),
      goal: '筋力アップと姿勢改善',
      follow_status: 'none'
    },
    {
      facility_code: facilityCode,
      customer_no: 'GYM-DEMO-003',
      line_user_id: 'demo_gym_line_003',
      full_name: '高橋 奈緒',
      phone: '０８０ー１１１１ー２２０３',
      phone_normalized: '08011112203',
      status: 'member',
      plan_name: '月4回プラン',
      ticket_remaining: 1,
      ticket_expires_on: addDaysYmd(today, 20),
      visit_count: 11,
      last_visit_on: addDaysYmd(today, -7),
      goal: '腰への負担を減らして体力をつけたい',
      precautions: '腰に不安あり。高負荷種目は当日の状態を確認。',
      follow_status: 'needed',
      next_follow_on: today
    },
    {
      facility_code: facilityCode,
      customer_no: 'GYM-DEMO-004',
      line_user_id: 'demo_gym_line_004',
      full_name: '山本 大輔',
      phone: '+81 90-1111-2204',
      phone_normalized: '09011112204',
      status: 'inactive',
      plan_name: '回数券8回',
      ticket_remaining: 0,
      visit_count: 8,
      last_visit_on: addDaysYmd(today, -55),
      goal: '運動習慣を再開したい',
      follow_status: 'scheduled',
      next_follow_on: secondOpen
    }
  ]);

  const byNo = Object.fromEntries(customers.map(row => [row.customer_no, row]));
  const reservationSpecs = [
    ['GYM-DEMO-001', 'trial60', 'trainer_01', nextOpen, '10:00', 'requested'],
    ['GYM-DEMO-002', 'personal60', 'trainer_02', nextOpen, '13:00', 'confirmed'],
    ['GYM-DEMO-003', 'personal60', 'trainer_01', secondOpen, '11:30', 'confirmed'],
    ['GYM-DEMO-002', 'personal90', 'trainer_02', thirdOpen, '18:00', 'requested']
  ];
  const reservations = [];

  for (const [customerNo, serviceCode, trainerCode, date, time, status] of reservationSpecs) {
    const service = await getService(env, facilityCode, serviceCode);
    const startAt = jstDateTime(date, time);
    const row = await callRpc(env, 'gym_create_reservation_atomic', {
      p_facility_code: facilityCode,
      p_reservation_no: makeReservationNo('D'),
      p_customer_id: byNo[customerNo].id,
      p_service_code: serviceCode,
      p_trainer_code: trainerCode,
      p_start_at: startAt.toISOString(),
      p_end_at: addMinutes(startAt, Number(service.duration_minutes)).toISOString(),
      p_status: status,
      p_channel: 'demo',
      p_customer_message: customerNo === 'GYM-DEMO-001' ? '運動が続くか不安です。' : null,
      p_admin_note: '営業デモ用データ'
    });
    reservations.push(row);
  }

  const inquiryRows = await insertRows(env, TABLES.inquiries, [{
    facility_code: facilityCode,
    customer_id: byNo['GYM-DEMO-003'].id,
    inquiry_type: 'continuation',
    message: '残り1回なので、次のプランについて相談したいです。',
    status: 'open'
  }]);

  await insertRows(env, TABLES.interactionLogs, [{
    facility_code: facilityCode,
    customer_id: byNo['GYM-DEMO-002'].id,
    reservation_id: reservations[1].id,
    interaction_type: 'reservation_confirmed',
    title: '予約確定案内',
    message_body: '次回予約の確定案内を作成しました。',
    status: 'recorded',
    created_by: 'demo_prepare'
  }]);

  await logActivity(env, facilityCode, 'demo_prepare_completed', 'system', 'STEP_GYM_1', {
    customers: customers.length,
    reservations: reservations.length,
    inquiries: inquiryRows.length
  }, 'demo_prepare');

  return {
    ok: true,
    message: 'DPRO パーソナルジムの営業前デモデータを準備しました。',
    version: VERSION,
    facility_code: facilityCode,
    production_guard: true,
    demo_data: {
      customers: customers.length,
      reservations: reservations.length,
      inquiries: inquiryRows.length,
      next_open_date: nextOpen
    }
  };
}

async function handleAdminSystemCheck(url, env) {
  const facilityCode = getFacilityCode(url, env);
  const startedAt = new Date();
  const checks = [];
  let facility = null;
  let settings = null;
  let services = [];
  let trainers = [];
  let customers = [];
  let reservations = [];
  let inquiries = [];

  try {
    [facility, settings, services, trainers, customers, reservations, inquiries] = await Promise.all([
      getFacility(env, facilityCode),
      getSettings(env, facilityCode),
      listServices(env, facilityCode),
      listTrainers(env, facilityCode),
      selectRows(env, TABLES.customers, { select: 'id', facility_code: `eq.${facilityCode}`, limit: '1000' }),
      selectRows(env, TABLES.reservations, { select: 'id,status,start_at', facility_code: `eq.${facilityCode}`, limit: '1000' }),
      selectRows(env, TABLES.inquiries, { select: 'id,status', facility_code: `eq.${facilityCode}`, limit: '1000' })
    ]);
    checks.push(check('database_connection', true, '新しいgym_テーブルへ接続できました。'));
  } catch (error) {
    checks.push(check('database_connection', false, safeErrorMessage(error)));
  }

  checks.push(check('facility', Boolean(facility?.is_active), facility ? facility.facility_name : '施設情報なし'));
  checks.push(check('production_guard', Boolean(facility?.production_guard), '本番誤操作ガード'));
  checks.push(check('slot_minutes_30', Number(settings?.default_slot_minutes) === 30, `${settings?.default_slot_minutes ?? '-'}分`));
  checks.push(check('services', services.length > 0, `${services.length}件`));
  checks.push(check('trainers', trainers.length > 0, `${trainers.length}名`));

  const phoneCheck = handlePhoneNormalizeCheck();
  checks.push(check('phone_normalization', phoneCheck.ok, phoneCheck.expected));

  let atomicFunctionOk = false;
  try {
    await callRpc(env, 'gym_update_reservation_status_atomic', {
      p_reservation_id: '00000000-0000-4000-8000-000000000000',
      p_new_status: 'confirmed',
      p_admin_note: null,
      p_created_by: 'system_check'
    });
  } catch (error) {
    atomicFunctionOk = safeErrorMessage(error).includes('GYM_RESERVATION_NOT_FOUND');
  }
  checks.push(check('atomic_reservation_guard', atomicFunctionOk, '重複予約の同時登録ガード'));
  checks.push(check('admin_token', Boolean(env.ADMIN_TOKEN || env.ALLOW_DEMO_ADMIN_FALLBACK === 'true'), '管理コード設定'));

  let next4 = null;
  try {
    next4 = await callRpc(env, 'gym_next_4_system_check', {
      p_facility_code: facilityCode
    });
    checks.push(check(
      'next4_session_records',
      Boolean(
        next4?.ok &&
        next4?.session_records &&
        next4?.completion_guard &&
        next4?.ticket_completion_unique_guard
      ),
      `記録 ${next4?.session_record_count ?? 0}件 / 重複完了 ${next4?.duplicate_completion_count ?? '-'}件`
    ));
  } catch (error) {
    checks.push(check(
      'next4_session_records',
      false,
      safeErrorMessage(error)
    ));
  }

  let next5 = null;
  try {
    next5 = await callRpc(env, 'gym_next_5_system_check', {
      p_facility_code: facilityCode
    });
    checks.push(check(
      'next5_trial_admission',
      Boolean(
        next5?.ok &&
        next5?.plan_master &&
        next5?.trial_pipeline &&
        next5?.atomic_admission &&
        next5?.membership_grant_guard
      ),
      `有効プラン ${next5?.active_plan_count ?? 0}件 / 重複入会 ${next5?.duplicate_active_memberships ?? '-'}件`
    ));
  } catch (error) {
    checks.push(check(
      'next5_trial_admission',
      false,
      safeErrorMessage(error)
    ));
  }

  const ok = checks.every(item => item.ok);
  return {
    ok,
    service: SERVICE,
    version: VERSION,
    facility_code: facilityCode,
    checked_at: new Date().toISOString(),
    elapsed_ms: new Date() - startedAt,
    checks,
    counts: {
      customers: customers.length,
      reservations: reservations.length,
      open_reservations: reservations.filter(row => !['completed', 'cancelled', 'no_show'].includes(row.status)).length,
      open_inquiries: inquiries.filter(row => row.status !== 'closed').length,
      services: services.length,
      trainers: trainers.length
    },
    next4,
    next5,
    urls: {
      public_site: env.PUBLIC_SITE_URL || null,
      health: '/api/health',
      demo_prepare: '/api/admin/demo-prepare'
    }
  };
}

async function buildAvailability(env, { facilityCode, date, serviceCode, trainerCode }) {
  const [settings, service] = await Promise.all([
    getSettings(env, facilityCode),
    getService(env, facilityCode, serviceCode)
  ]);

  if (!settings || !service?.is_active) {
    throw new HttpError(404, 'BOOKING_CONFIG_NOT_FOUND', '予約設定またはメニューが見つかりません。');
  }

  if (date < todayJst()) {
    return { date, service, trainer_code: trainerCode || null, closed: true, reason: 'past_date', slots: [] };
  }

  const dayOfWeek = jstDateTime(date, '00:00').getDay();
  const closedDays = (settings.weekly_closed_days || []).map(Number);
  const closedDates = settings.special_closed_dates || [];
  if (closedDays.includes(dayOfWeek)) {
    return { date, service, trainer_code: trainerCode || null, closed: true, reason: 'weekly_holiday', slots: [] };
  }
  if (closedDates.includes(date)) {
    return { date, service, trainer_code: trainerCode || null, closed: true, reason: 'special_closed_date', slots: [] };
  }

  let openTime = trimTime(settings.open_time);
  let closeTime = trimTime(settings.close_time);
  if (trainerCode) {
    const trainer = await getTrainer(env, facilityCode, trainerCode);
    if (!trainer?.is_active) {
      return { date, service, trainer_code: trainerCode, closed: true, reason: 'trainer_unavailable', slots: [] };
    }
    const hours = await selectOne(env, TABLES.trainerHours, {
      select: '*',
      facility_code: `eq.${facilityCode}`,
      trainer_code: `eq.${trainerCode}`,
      day_of_week: `eq.${dayOfWeek}`,
      is_active: 'eq.true'
    });
    if (!hours) {
      return { date, service, trainer_code: trainerCode, closed: true, reason: 'trainer_day_off', slots: [] };
    }
    openTime = maxTime(openTime, trimTime(hours.start_time));
    closeTime = minTime(closeTime, trimTime(hours.end_time));
  }

  const dayStart = jstDateTime(date, '00:00');
  const dayEnd = addDays(dayStart, 1);
  const reservations = await selectRows(env, TABLES.reservations, {
    select: 'id,trainer_code,start_at,end_at,status',
    facility_code: `eq.${facilityCode}`,
    start_at: `lt.${dayEnd.toISOString()}`,
    end_at: `gt.${dayStart.toISOString()}`,
    status: 'not.in.(cancelled,no_show)',
    order: 'start_at.asc',
    limit: '500'
  });

  const duration = Number(service.duration_minutes);
  const slotMinutes = 30;
  const minLeadMs = Number(settings.min_lead_hours || 0) * 60 * 60 * 1000;
  const earliest = Date.now() + minLeadMs;
  const openAt = jstDateTime(date, openTime);
  const closeAt = jstDateTime(date, closeTime);
  const slots = [];

  for (let start = new Date(openAt); addMinutes(start, duration) <= closeAt; start = addMinutes(start, slotMinutes)) {
    const end = addMinutes(start, duration);
    const overlap = reservations.filter(row =>
      ACTIVE_RESERVATION_STATUSES.has(row.status) &&
      new Date(row.start_at) < end && new Date(row.end_at) > start
    );
    const facilityFull = overlap.length >= Number(settings.max_parallel_sessions || 1);
    const trainerBusy = trainerCode && overlap.some(row => row.trainer_code === trainerCode);
    const pastLeadTime = start.getTime() < earliest;
    const available = !facilityFull && !trainerBusy && !pastLeadTime;
    slots.push({
      time: formatJstTime(start),
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      available,
      reason: available ? null : (pastLeadTime ? 'lead_time' : trainerBusy ? 'trainer_busy' : 'full')
    });
  }

  return {
    date,
    service,
    trainer_code: trainerCode || null,
    closed: false,
    reason: null,
    slot_minutes: 30,
    slots
  };
}

async function findOrCreateCustomer(env, input) {
  let customer = null;
  if (input.lineUserId) {
    customer = await selectOne(env, TABLES.customers, {
      select: '*',
      facility_code: `eq.${input.facilityCode}`,
      line_user_id: `eq.${input.lineUserId}`
    });
  }

  if (!customer && input.phoneNormalized) {
    const phoneMatches = await selectRows(env, TABLES.customers, {
      select: '*',
      facility_code: `eq.${input.facilityCode}`,
      phone_normalized: `eq.${input.phoneNormalized}`,
      order: 'updated_at.desc',
      limit: '2'
    });
    if (phoneMatches.length > 1) {
      throw new HttpError(409, 'CUSTOMER_DUPLICATE_REVIEW', '同じ電話番号の会員が複数見つかりました。店舗へお問い合わせください。');
    }
    customer = phoneMatches[0] || null;
    if (customer?.line_user_id && input.lineUserId && customer.line_user_id !== input.lineUserId) {
      throw new HttpError(409, 'PHONE_ALREADY_LINKED', 'この電話番号は別のLINEアカウントと連携済みです。店舗へお問い合わせください。');
    }
  }

  const patch = compactObject({
    full_name: input.fullName,
    phone: input.phone,
    phone_normalized: input.phoneNormalized,
    line_user_id: input.lineUserId || undefined,
    goal: input.goal || undefined,
    concern: input.concern || undefined
  });

  if (customer) {
    const rows = await patchRows(env, TABLES.customers, { id: `eq.${customer.id}` }, patch);
    return rows[0] || customer;
  }

  const rows = await insertRows(env, TABLES.customers, [{
    facility_code: input.facilityCode,
    customer_no: makeCustomerNo(),
    full_name: input.fullName,
    phone: input.phone,
    phone_normalized: input.phoneNormalized,
    line_user_id: input.lineUserId || null,
    status: validCustomerStatus(input.status) ? input.status : 'trial',
    goal: input.goal || null,
    concern: input.concern || null
  }]);
  return rows[0];
}

async function resolveMemberCustomer(request, env, facility, input) {
  const facilityCode = clean(input.facility_code) || facility.facility_code;
  const memberToken = clean(input.member_token);
  if (memberToken) {
    const byToken = await selectOne(env, TABLES.customers, {
      select: '*',
      facility_code: `eq.${facilityCode}`,
      public_token: `eq.${memberToken}`
    });
    if (byToken) return byToken;
  }

  const identity = await resolveLineIdentity(request, env, facility, input);
  if (identity?.userId) {
    const byLine = await selectOne(env, TABLES.customers, {
      select: '*',
      facility_code: `eq.${facilityCode}`,
      line_user_id: `eq.${identity.userId}`
    });
    if (byLine) return byLine;
  }

  throw new HttpError(404, 'MEMBER_NOT_FOUND', '会員情報が見つかりません。初回予約から登録してください。');
}

async function resolveLineIdentity(request, env, facility, input) {
  const accessToken = request.headers.get('x-liff-access-token');
  const requestedUserId = clean(input.line_user_id);
  if (accessToken) {
    const response = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      throw new HttpError(401, 'LINE_AUTH_FAILED', 'LINEアカウントの確認に失敗しました。LINEから開き直してください。');
    }
    const profile = await response.json();
    if (requestedUserId && requestedUserId !== profile.userId) {
      throw new HttpError(403, 'LINE_USER_MISMATCH', 'LINEアカウント情報が一致しません。');
    }
    return { userId: profile.userId, displayName: profile.displayName || null, verified: true };
  }

  const demoAllowed = Boolean(facility?.is_demo) && (
    input.demo === true || input.demo === '1' || requestedUserId.startsWith('demo_gym_line_')
  );
  if (demoAllowed && requestedUserId) {
    return { userId: requestedUserId, displayName: null, verified: false, demo: true };
  }

  if (env.REQUIRE_LINE_AUTH === 'false') {
    return requestedUserId ? { userId: requestedUserId, displayName: null, verified: false } : null;
  }

  if (!requestedUserId) return null;
  throw new HttpError(401, 'LINE_AUTH_REQUIRED', 'LINEから開き直してください。');
}

async function getFacility(env, facilityCode) {
  const row = await selectOne(env, TABLES.facilities, {
    select: '*', facility_code: `eq.${facilityCode}`
  });
  if (!row) throw new HttpError(404, 'FACILITY_NOT_FOUND', '施設情報が見つかりません。');
  return row;
}

async function getSettings(env, facilityCode) {
  const row = await selectOne(env, TABLES.settings, {
    select: '*', facility_code: `eq.${facilityCode}`
  });
  if (!row) throw new HttpError(404, 'SETTINGS_NOT_FOUND', '予約設定が見つかりません。');
  return row;
}

async function listServices(env, facilityCode, activeOnly = true) {
  const filters = {
    select: '*', facility_code: `eq.${facilityCode}`, order: 'sort_order.asc,service_name.asc'
  };
  if (activeOnly) filters.is_active = 'eq.true';
  return selectRows(env, TABLES.services, filters);
}

async function getService(env, facilityCode, serviceCode) {
  return selectOne(env, TABLES.services, {
    select: '*', facility_code: `eq.${facilityCode}`, service_code: `eq.${serviceCode}`
  });
}

async function listTrainers(env, facilityCode, activeOnly = true) {
  const filters = {
    select: '*', facility_code: `eq.${facilityCode}`, order: 'sort_order.asc,trainer_name.asc'
  };
  if (activeOnly) filters.is_active = 'eq.true';
  return selectRows(env, TABLES.trainers, filters);
}

async function getTrainer(env, facilityCode, trainerCode) {
  return selectOne(env, TABLES.trainers, {
    select: '*', facility_code: `eq.${facilityCode}`, trainer_code: `eq.${trainerCode}`
  });
}

function publicFacility(row) {
  if (!row) return null;
  return {
    facility_code: row.facility_code,
    facility_name: row.facility_name,
    subtitle: row.subtitle,
    timezone: row.timezone,
    phone: row.phone,
    address: row.address,
    is_demo: Boolean(row.is_demo)
  };
}

function publicSettings(row) {
  if (!row) return null;
  return {
    open_time: trimTime(row.open_time),
    close_time: trimTime(row.close_time),
    default_slot_minutes: Number(row.default_slot_minutes),
    max_booking_days: Number(row.max_booking_days),
    min_lead_hours: Number(row.min_lead_hours),
    cancellation_deadline_hours: Number(row.cancellation_deadline_hours),
    weekly_closed_days: row.weekly_closed_days || [],
    special_closed_dates: row.special_closed_dates || [],
    booking_notice: row.booking_notice
  };
}

function memberCustomer(row, includeToken) {
  if (!row) return null;
  const result = {
    id: row.id,
    customer_no: row.customer_no,
    full_name: row.full_name,
    phone: row.phone,
    status: row.status,
    plan_name: row.plan_name,
    ticket_remaining: Number(row.ticket_remaining || 0),
    ticket_expires_on: row.ticket_expires_on,
    visit_count: Number(row.visit_count || 0),
    last_visit_on: row.last_visit_on,
    goal: row.goal,
    concern: row.concern,
    follow_status: row.follow_status,
    next_follow_on: row.next_follow_on
  };
  if (includeToken) result.public_token = row.public_token;
  return result;
}

function adminCustomer(row) {
  if (!row) return null;
  return {
    id: row.id,
    customer_no: row.customer_no,
    line_user_id: row.line_user_id,
    full_name: row.full_name,
    full_name_kana: row.full_name_kana,
    phone: row.phone,
    phone_normalized: row.phone_normalized,
    status: row.status,
    plan_name: row.plan_name,
    ticket_remaining: Number(row.ticket_remaining || 0),
    ticket_expires_on: row.ticket_expires_on,
    visit_count: Number(row.visit_count || 0),
    last_visit_on: row.last_visit_on,
    goal: row.goal,
    concern: row.concern,
    precautions: row.precautions,
    owner_note: row.owner_note,
    follow_status: row.follow_status,
    next_follow_on: row.next_follow_on,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function memberReservation(row) {
  if (!row) return null;
  return {
    id: row.id,
    reservation_no: row.reservation_no,
    service_code: row.service_code,
    trainer_code: row.trainer_code,
    start_at: row.start_at,
    end_at: row.end_at,
    status: row.status,
    customer_message: row.customer_message,
    cancel_reason: row.cancel_reason,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function adminReservation(row, customer) {
  if (!row) return null;
  return {
    ...memberReservation(row),
    facility_code: row.facility_code,
    customer_id: row.customer_id,
    channel: row.channel,
    admin_note: row.admin_note,
    completed_at: row.completed_at,
    customer: adminCustomer(customer)
  };
}

function adminSessionRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    facility_code: row.facility_code,
    reservation_id: row.reservation_id,
    customer_id: row.customer_id,
    trainer_code: row.trainer_code,
    performed_at: row.performed_at,
    record_status: row.record_status,
    condition_note: row.condition_note,
    training_summary: row.training_summary,
    trainer_note: row.trainer_note,
    next_focus: row.next_focus,
    member_visible_comment: row.member_visible_comment,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function adminPlan(row) {
  if (!row) return null;
  return {
    id: row.id,
    facility_code: row.facility_code,
    plan_code: row.plan_code,
    plan_name: row.plan_name,
    plan_type: row.plan_type,
    included_sessions: Number(row.included_sessions || 0),
    validity_days: Number(row.validity_days || 0),
    price_yen:
      row.price_yen === null || row.price_yen === undefined
        ? null
        : Number(row.price_yen),
    description: row.description,
    is_active: Boolean(row.is_active),
    sort_order: Number(row.sort_order || 0),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function adminMembership(row) {
  if (!row) return null;
  return {
    id: row.id,
    facility_code: row.facility_code,
    customer_id: row.customer_id,
    plan_code: row.plan_code,
    plan_name_snapshot: row.plan_name_snapshot,
    plan_type_snapshot: row.plan_type_snapshot,
    included_sessions: Number(row.included_sessions || 0),
    started_on: row.started_on,
    expires_on: row.expires_on,
    status: row.status,
    source: row.source,
    admission_note: row.admission_note,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function validateBookingWindow(startAt, settings, adminMode = false) {
  if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) {
    throw new HttpError(400, 'INVALID_START_AT', '予約日時が正しくありません。');
  }
  if (![0, 30].includes(Number(formatJstTime(startAt).split(':')[1]))) {
    throw new HttpError(400, 'SLOT_MUST_BE_30_MINUTES', '予約開始時刻は30分単位で選択してください。');
  }
  const today = todayJst();
  const startDate = formatJstDate(startAt);
  if (startDate < today || (!adminMode && startAt.getTime() < Date.now())) {
    throw new HttpError(400, 'PAST_RESERVATION_NOT_ALLOWED', '過去の日時は予約できません。');
  }
  if (startDate > addDaysYmd(today, Number(settings.max_booking_days || 60))) {
    throw new HttpError(400, 'BOOKING_WINDOW_EXCEEDED', '予約可能期間を超えています。');
  }
}

function parseReservationStart(value) {
  const text = clean(value);
  if (!text) throw new HttpError(400, 'START_AT_REQUIRED', '予約日時を選択してください。');
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, 'INVALID_START_AT', '予約日時が正しくありません。');
  return date;
}

function normalizePhone(value) {
  let text = String(value || '').normalize('NFKC').trim();
  text = text.replace(/[‐‑‒–—―ーｰ−]/g, '-');
  const hadPlus81 = /^\s*\+\s*81/.test(text);
  let digits = text.replace(/\D/g, '');
  if (hadPlus81 && digits.startsWith('81')) digits = `0${digits.slice(2)}`;
  if (digits.startsWith('0081')) digits = `0${digits.slice(4)}`;
  return digits;
}

function isValidPhone(value) {
  return /^0\d{9,10}$/.test(String(value || ''));
}

async function selectRows(env, table, filters = {}) {
  const data = await postgrest(env, `/rest/v1/${table}?${toQuery(filters)}`);
  return Array.isArray(data) ? data : [];
}

async function selectOne(env, table, filters = {}) {
  const rows = await selectRows(env, table, { ...filters, limit: '1' });
  return rows[0] || null;
}

function haveSameObjectKeys(rows) {
  if (!Array.isArray(rows) || rows.length <= 1) return true;

  const firstKeys = Object.keys(rows[0] || {}).sort().join('\u0000');
  return rows.every(row =>
    Object.keys(row || {}).sort().join('\u0000') === firstKeys
  );
}

async function insertRows(env, table, rows, onConflict = '') {
  const inputRows = Array.isArray(rows) ? rows : [rows];
  if (!inputRows.length) return [];

  /*
   * PostgRESTでは、1回の配列POSTに含まれる全オブジェクトのキーが
   * 完全一致している必要があります。
   *
   * 営業デモ会員は、plan_name・ticket_expires_on・precautions等の
   * 任意項目が会員ごとに異なるため、キー構成が違う場合だけ
   * 1件ずつ安全に登録します。
   *
   * キー構成が同じ通常の一括登録は、従来どおり1回で実行します。
   */
  if (inputRows.length > 1 && !haveSameObjectKeys(inputRows)) {
    const insertedRows = [];

    for (const row of inputRows) {
      const suffix = onConflict
        ? `?on_conflict=${encodeURIComponent(onConflict)}`
        : '';

      const data = await postgrest(env, `/rest/v1/${table}${suffix}`, {
        method: 'POST',
        body: [row],
        prefer: onConflict
          ? 'resolution=merge-duplicates,return=representation'
          : 'return=representation'
      });

      if (Array.isArray(data)) insertedRows.push(...data);
    }

    return insertedRows;
  }

  const suffix = onConflict
    ? `?on_conflict=${encodeURIComponent(onConflict)}`
    : '';

  const data = await postgrest(env, `/rest/v1/${table}${suffix}`, {
    method: 'POST',
    body: inputRows,
    prefer: onConflict
      ? 'resolution=merge-duplicates,return=representation'
      : 'return=representation'
  });

  return Array.isArray(data) ? data : [];
}

async function patchRows(env, table, filters, payload) {
  if (!Object.keys(payload || {}).length) return [];
  const data = await postgrest(env, `/rest/v1/${table}?${toQuery(filters)}`, {
    method: 'PATCH',
    body: payload,
    prefer: 'return=representation'
  });
  return Array.isArray(data) ? data : [];
}

async function deleteRows(env, table, filters) {
  return postgrest(env, `/rest/v1/${table}?${toQuery(filters)}`, {
    method: 'DELETE',
    prefer: 'return=minimal',
    allowEmpty: true
  });
}

async function callRpc(env, functionName, payload) {
  return postgrest(env, `/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    body: payload,
    prefer: 'return=representation'
  });
}

async function postgrest(env, path, options = {}) {
  const baseUrl = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json'
  };
  if (options.prefer) headers.Prefer = options.prefer;

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  if (options.raw) return response;
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (_) { data = text; }
  }

  if (!response.ok) {
    const message = typeof data === 'object' && data
      ? [data.message, data.details, data.hint].filter(Boolean).join(' / ')
      : String(data || `Supabase HTTP ${response.status}`);
    throw new HttpError(response.status >= 500 ? 502 : response.status, 'DATABASE_ERROR', message, data);
  }

  if (options.allowEmpty && !text) return null;
  return data;
}

async function logActivity(env, facilityCode, action, targetType, targetId, detail, createdBy) {
  try {
    await insertRows(env, TABLES.activityLogs, [{
      facility_code: facilityCode,
      action,
      target_type: targetType || null,
      target_id: targetId ? String(targetId) : null,
      detail: detail || {},
      created_by: createdBy || 'system'
    }]);
  } catch (error) {
    console.warn('activity log skipped', safeErrorMessage(error));
  }
}

function translateReservationError(error) {
  const message = safeErrorMessage(error);
  if (message.includes('GYM_SLOT_FULL')) {
    return new HttpError(409, 'SLOT_FULL', 'この時間は満席になりました。別の時間を選択してください。');
  }
  if (message.includes('GYM_TRAINER_BUSY')) {
    return new HttpError(409, 'TRAINER_BUSY', '選択したトレーナーはこの時間に対応できません。');
  }
  if (message.includes('GYM_SLOT_MUST_BE_30_MINUTES')) {
    return new HttpError(400, 'SLOT_MUST_BE_30_MINUTES', '予約開始時刻は30分単位で選択してください。');
  }
  return error;
}

function requireAdmin(request, env) {
  const url = new URL(request.url);
  const supplied = request.headers.get('x-admin-key') ||
    bearerToken(request.headers.get('authorization')) ||
    url.searchParams.get('admin_key') || '';
  const expected = env.ADMIN_TOKEN || (env.ALLOW_DEMO_ADMIN_FALLBACK === 'true' ? '1234' : '');
  if (!expected) {
    throw new HttpError(503, 'ADMIN_TOKEN_NOT_CONFIGURED', 'WorkerのADMIN_TOKENを設定してください。');
  }
  if (!safeEqual(String(supplied), String(expected))) {
    throw new HttpError(401, 'ADMIN_AUTH_FAILED', '管理コードが正しくありません。');
  }
}

function validateEnvironment(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError(503, 'WORKER_ENV_NOT_CONFIGURED', 'WorkerのSupabase接続設定が不足しています。');
  }
}

function getDefaultFacilityCode(env) {
  return clean(env.DEMO_FACILITY_CODE) || DEFAULT_FACILITY_CODE;
}

function getFacilityCode(url, env) {
  return clean(url.searchParams.get('facility_code')) || getDefaultFacilityCode(env);
}

function check(id, ok, detail) {
  return { id, ok: Boolean(ok), detail };
}

function responseHeaders(extra = {}) {
  return {
    ...CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-DPRO-Worker-Version': VERSION,
    ...extra
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: responseHeaders()
  });
}

function errorResponse(error) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
  const message = error instanceof HttpError ? error.message : '処理中にエラーが発生しました。';
  if (!(error instanceof HttpError)) console.error(error);
  return json({
    ok: false,
    error: code,
    message,
    version: VERSION
  }, status);
}

class HttpError extends Error {
  constructor(status, code, message, detail = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

async function readJson(request) {
  try {
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch (_) {
    throw new HttpError(400, 'INVALID_JSON', '送信内容の形式が正しくありません。');
  }
}

function toQuery(filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters || {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

function clean(value) {
  return String(value ?? '').trim();
}

function cleanName(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function cleanMultiline(value, maxLength = 2000) {
  return String(value ?? '').normalize('NFKC').replace(/\r\n/g, '\n').trim().slice(0, maxLength);
}

function normalizeSearch(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s　-]/g, '');
}

function normalizePath(pathname) {
  const path = String(pathname || '/').replace(/\/{2,}/g, '/');
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, item]) => item !== undefined));
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function bearerToken(value) {
  const match = String(value || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function safeErrorMessage(error) {
  return String(error?.message || error || '不明なエラー').slice(0, 800);
}

function makeCustomerNo() {
  return `GYM-${todayJst().replace(/-/g, '')}-${randomCode(6)}`;
}

function makeReservationNo(prefix = '') {
  return `GR-${prefix}${todayJst().replace(/-/g, '')}-${randomCode(6)}`;
}

function randomCode(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(bytes, byte => chars[byte % chars.length]).join('');
}

function validCustomerStatus(value) {
  return ['trial', 'member', 'continuation', 'inactive', 'withdrawn'].includes(value);
}

function isFiniteNumber(value) {
  return value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));
}

function integerBetween(value, min, max) {
  if (!Number.isInteger(Number(value))) return undefined;
  const number = Number(value);
  return number >= min && number <= max ? number : undefined;
}

function validWeekdays(value) {
  return Array.isArray(value) && value.every(item => Number.isInteger(Number(item)) && Number(item) >= 0 && Number(item) <= 6);
}

function validDateArray(value) {
  return Array.isArray(value) && value.every(isYmd);
}

function isYmd(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = jstDateTime(text, '00:00');
  return !Number.isNaN(parsed.getTime()) && formatJstDate(parsed) === text;
}

function isHm(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

function trimTime(value) {
  const match = String(value || '').match(/^(\d{2}:\d{2})/);
  return match ? match[1] : String(value || '');
}

function maxTime(a, b) {
  return a >= b ? a : b;
}

function minTime(a, b) {
  return a <= b ? a : b;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + Number(minutes) * 60 * 1000);
}

function addDays(date, days) {
  return new Date(date.getTime() + Number(days) * 24 * 60 * 60 * 1000);
}

function jstDateTime(date, time) {
  return new Date(`${date}T${trimTime(time)}:00+09:00`);
}

function todayJst() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: JST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function formatJstDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: JST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function formatJstTime(date) {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: JST,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function addDaysYmd(ymd, days) {
  return formatJstDate(addDays(jstDateTime(ymd, '12:00'), days));
}

function nextBusinessDate(fromYmd, offset = 1) {
  let date = fromYmd;
  let found = 0;
  while (found < offset) {
    date = addDaysYmd(date, 1);
    const day = jstDateTime(date, '00:00').getDay();
    if (day !== 0) found += 1;
  }
  return date;
}
