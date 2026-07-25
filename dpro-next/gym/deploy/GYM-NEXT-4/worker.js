/* ============================================================
  STEP GYM-NEXT-4
  DPRO パーソナルジム LINE API - NEXT Gateway

  Deploy this as a NEW Cloudflare Worker:
    dpro-gym-line-api-next

  Required secrets:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
    ADMIN_TOKEN

  Optional variables:
    LEGACY_WORKER_URL
      default: https://dpro-gym-line-api.dpromstk2000.workers.dev
    DEMO_FACILITY_CODE
      default: dpro_gym_demo

  This gateway handles NEXT-4 APIs and safely proxies every other
  existing API request to the current GYM-6-R2 Worker.
============================================================ */

const VERSION = 'GYM-NEXT-4-GATEWAY-20260725';
const SERVICE = 'DPRO Personal Gym LINE API NEXT Gateway';
const DEFAULT_FACILITY_CODE = 'dpro_gym_demo';
const DEFAULT_LEGACY_WORKER_URL =
  'https://dpro-gym-line-api.dpromstk2000.workers.dev';

const TABLES = Object.freeze({
  sessionRecords: 'gym_session_records',
  ticketLedger: 'gym_ticket_ledger'
});

const RESERVATION_STATUSES = new Set([
  'requested',
  'confirmed',
  'arrived',
  'in_session',
  'completed',
  'change_requested',
  'cancel_requested',
  'cancelled',
  'no_show'
]);

const CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Admin-Key, X-LIFF-Access-Token, X-Demo-Confirm',
  'Access-Control-Expose-Headers':
    'Content-Type, X-DPRO-Worker-Version, X-DPRO-Legacy-Worker-Version',
  'Access-Control-Max-Age': '86400'
});

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
        return json(await handleHealth(request, env));
      }

      if (path.startsWith('/api/admin/')) {
        if (isNextAdminRoute(path, request.method)) {
          requireAdmin(request, env);

          if (path === '/api/admin/reservations/status' && request.method === 'POST') {
            return json(await handleReservationStatus(request, env));
          }

          if (path === '/api/admin/sessions/complete' && request.method === 'POST') {
            return json(await handleSessionComplete(request, env));
          }

          if (path === '/api/admin/session-records/upsert' && request.method === 'POST') {
            return json(await handleSessionRecordUpsert(request, env));
          }

          if (path === '/api/admin/session-records' && request.method === 'GET') {
            return json(await handleSessionRecordsList(url, env));
          }

          const sessionMatch = path.match(
            /^\/api\/admin\/customers\/([^/]+)\/session-records$/
          );
          if (sessionMatch && request.method === 'GET') {
            return json(
              await handleCustomerSessionRecords(
                url,
                env,
                decodeURIComponent(sessionMatch[1])
              )
            );
          }

          const ledgerMatch = path.match(
            /^\/api\/admin\/customers\/([^/]+)\/ticket-ledger$/
          );
          if (ledgerMatch && request.method === 'GET') {
            return json(
              await handleCustomerTicketLedger(
                url,
                env,
                decodeURIComponent(ledgerMatch[1])
              )
            );
          }

          if (path === '/api/admin/next-4-system-check' && request.method === 'GET') {
            return json(await handleNext4SystemCheck(url, env));
          }
        }
      }

      return proxyLegacy(request, env);
    } catch (error) {
      return errorResponse(error);
    }
  }
};

function isNextAdminRoute(path, method) {
  if (path === '/api/admin/reservations/status' && method === 'POST') return true;
  if (path === '/api/admin/sessions/complete' && method === 'POST') return true;
  if (path === '/api/admin/session-records/upsert' && method === 'POST') return true;
  if (path === '/api/admin/session-records' && method === 'GET') return true;
  if (path === '/api/admin/next-4-system-check' && method === 'GET') return true;
  if (
    method === 'GET' &&
    /^\/api\/admin\/customers\/[^/]+\/(session-records|ticket-ledger)$/.test(path)
  ) {
    return true;
  }
  return false;
}

async function handleHealth(request, env) {
  const legacy = await fetchLegacyJson('/api/health', request, env);
  let next4 = {
    ok: false,
    session_records: false,
    completion_guard: false,
    ticket_completion_unique_guard: false
  };

  try {
    next4 = await callRpc(env, 'gym_next_4_system_check', {
      p_facility_code: getDefaultFacilityCode(env)
    });
  } catch (error) {
    next4 = {
      ok: false,
      error: safeErrorMessage(error)
    };
  }

  return {
    ...legacy,
    ok: Boolean(legacy?.ok && next4?.ok),
    service: SERVICE,
    version: VERSION,
    legacy_service: legacy?.service || null,
    legacy_version: legacy?.version || null,
    next4,
    features: {
      ...(legacy?.features || {}),
      next_gateway: true,
      persistent_session_records: Boolean(next4?.session_records),
      atomic_session_completion: Boolean(next4?.completion_guard),
      ticket_completion_unique_guard: Boolean(
        next4?.ticket_completion_unique_guard
      )
    }
  };
}

async function handleReservationStatus(request, env) {
  const body = await readJson(request);
  const facilityCode =
    clean(body.facility_code) || getDefaultFacilityCode(env);
  const reservationId = clean(body.reservation_id);
  const status = clean(body.status);

  if (!reservationId || !RESERVATION_STATUSES.has(status)) {
    throw new HttpError(
      400,
      'INVALID_RESERVATION_STATUS',
      '予約と変更後ステータスを正しく指定してください。'
    );
  }

  const result = await callRpc(env, 'gym_update_reservation_status_next', {
    p_reservation_id: reservationId,
    p_facility_code: facilityCode,
    p_new_status: status,
    p_admin_note: cleanMultiline(body.admin_note, 2000) || null,
    p_created_by: clean(body.created_by) || 'admin'
  });

  return {
    ok: true,
    reservation: result?.reservation || null,
    customer: result?.customer || null,
    idempotent: Boolean(result?.idempotent),
    version: VERSION
  };
}

async function handleSessionComplete(request, env) {
  const body = await readJson(request);
  const facilityCode =
    clean(body.facility_code) || getDefaultFacilityCode(env);
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
      '実施内容を入力してください。'
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

  return {
    ok: true,
    reservation: result?.reservation || null,
    customer: result?.customer || null,
    session_record: result?.session_record || null,
    idempotent: Boolean(result?.idempotent),
    version: VERSION
  };
}

async function handleSessionRecordUpsert(request, env) {
  const body = await readJson(request);
  const facilityCode =
    clean(body.facility_code) || getDefaultFacilityCode(env);
  const reservationId = clean(body.reservation_id);

  if (!reservationId) {
    throw new HttpError(
      400,
      'RESERVATION_REQUIRED',
      '記録対象の予約を指定してください。'
    );
  }

  const recordStatus = body.record_status === 'completed'
    ? 'completed'
    : 'draft';

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
    session_record: result,
    version: VERSION
  };
}

async function handleSessionRecordsList(url, env) {
  const facilityCode = getFacilityCode(url, env);
  const filters = {
    select: '*',
    facility_code: `eq.${facilityCode}`,
    order: 'performed_at.desc',
    limit: String(clampInt(url.searchParams.get('limit'), 1, 100, 20))
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
    session_records: rows,
    version: VERSION
  };
}

async function handleCustomerSessionRecords(url, env, customerId) {
  if (!customerId) {
    throw new HttpError(400, 'CUSTOMER_REQUIRED', '会員を指定してください。');
  }

  const nextUrl = new URL(url);
  nextUrl.searchParams.set('customer_id', customerId);
  return handleSessionRecordsList(nextUrl, env);
}

async function handleCustomerTicketLedger(url, env, customerId) {
  const facilityCode = getFacilityCode(url, env);
  if (!customerId) {
    throw new HttpError(400, 'CUSTOMER_REQUIRED', '会員を指定してください。');
  }

  const rows = await selectRows(env, TABLES.ticketLedger, {
    select:
      'id,facility_code,customer_id,reservation_id,change_amount,balance_after,reason,created_by,created_at',
    facility_code: `eq.${facilityCode}`,
    customer_id: `eq.${customerId}`,
    order: 'created_at.desc',
    limit: String(clampInt(url.searchParams.get('limit'), 1, 100, 30))
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

async function handleNext4SystemCheck(url, env) {
  return {
    ok: true,
    version: VERSION,
    result: await callRpc(env, 'gym_next_4_system_check', {
      p_facility_code: getFacilityCode(url, env)
    })
  };
}

async function proxyLegacy(request, env) {
  const legacyBase = getLegacyWorkerUrl(env);
  const requestUrl = new URL(request.url);
  const legacyUrl = new URL(
    `${requestUrl.pathname}${requestUrl.search}`,
    `${legacyBase}/`
  );

  if (requestUrl.origin === legacyUrl.origin) {
    throw new HttpError(
      500,
      'LEGACY_WORKER_RECURSION',
      'LEGACY_WORKER_URLは、このNEXT Workerとは別のURLを指定してください。'
    );
  }

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('X-DPRO-NEXT-Gateway', VERSION);

  const init = {
    method: request.method,
    headers,
    redirect: 'manual'
  };
  if (!['GET', 'HEAD'].includes(request.method)) {
    init.body = request.body;
  }

  const response = await fetch(legacyUrl.toString(), init);
  const responseHeadersCopy = new Headers(response.headers);
  responseHeadersCopy.set('X-DPRO-Worker-Version', VERSION);
  if (response.headers.get('X-DPRO-Worker-Version')) {
    responseHeadersCopy.set(
      'X-DPRO-Legacy-Worker-Version',
      response.headers.get('X-DPRO-Worker-Version')
    );
  }
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    responseHeadersCopy.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeadersCopy
  });
}

async function fetchLegacyJson(path, request, env) {
  const legacyBase = getLegacyWorkerUrl(env);
  const requestOrigin = new URL(request.url).origin;
  const legacyOrigin = new URL(legacyBase).origin;

  if (requestOrigin === legacyOrigin) {
    throw new HttpError(
      500,
      'LEGACY_WORKER_RECURSION',
      'LEGACY_WORKER_URLがNEXT Worker自身を指しています。'
    );
  }

  const response = await fetch(`${legacyBase}${path}`, {
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-store'
    }
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { ok: false, message: text };
  }

  if (!response.ok) {
    throw new HttpError(
      response.status,
      'LEGACY_WORKER_ERROR',
      data?.message || `Legacy Worker HTTP ${response.status}`,
      data
    );
  }

  return data;
}

function validateEnvironment(env) {
  const missing = [];
  if (!clean(env.SUPABASE_URL)) missing.push('SUPABASE_URL');
  if (!clean(env.SUPABASE_SERVICE_ROLE_KEY)) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY');
  }
  if (!clean(env.ADMIN_TOKEN)) missing.push('ADMIN_TOKEN');

  if (missing.length) {
    throw new HttpError(
      500,
      'ENVIRONMENT_MISSING',
      `Cloudflare Secretsが不足しています：${missing.join(', ')}`
    );
  }

  getLegacyWorkerUrl(env);
}

function requireAdmin(request, env) {
  const expected = clean(env.ADMIN_TOKEN);
  const supplied = clean(request.headers.get('X-Admin-Key'));

  if (!expected || !supplied || !safeEqual(expected, supplied)) {
    throw new HttpError(
      401,
      'ADMIN_AUTH_REQUIRED',
      '管理コードが正しくありません。'
    );
  }
}

function getLegacyWorkerUrl(env) {
  const value = clean(env.LEGACY_WORKER_URL) || DEFAULT_LEGACY_WORKER_URL;
  let url;
  try {
    url = new URL(value);
  } catch (_) {
    throw new HttpError(
      500,
      'INVALID_LEGACY_WORKER_URL',
      'LEGACY_WORKER_URLが正しくありません。'
    );
  }

  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new HttpError(
      500,
      'INVALID_LEGACY_WORKER_URL',
      'LEGACY_WORKER_URLはHTTPまたはHTTPSで指定してください。'
    );
  }

  return url.origin;
}

function getDefaultFacilityCode(env) {
  return clean(env.DEMO_FACILITY_CODE) || DEFAULT_FACILITY_CODE;
}

function getFacilityCode(url, env) {
  return clean(url.searchParams.get('facility_code')) ||
    getDefaultFacilityCode(env);
}

async function selectRows(env, table, filters = {}) {
  const result = await postgrest(
    env,
    `/rest/v1/${table}?${toQuery(filters)}`
  );
  return Array.isArray(result) ? result : [];
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
    body:
      options.body === undefined
        ? undefined
        : JSON.stringify(options.body)
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = text;
    }
  }

  if (!response.ok) {
    const message =
      typeof data === 'object' && data
        ? [data.message, data.details, data.hint]
            .filter(Boolean)
            .join(' / ')
        : String(data || `Supabase HTTP ${response.status}`);

    throw new HttpError(
      response.status >= 500 ? 502 : response.status,
      'DATABASE_ERROR',
      message,
      data
    );
  }

  return data;
}

async function readJson(request) {
  const text = await request.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch (_) {
    throw new HttpError(
      400,
      'INVALID_JSON',
      '送信データの形式が正しくありません。'
    );
  }
}

function toQuery(filters) {
  const query = new URLSearchParams();
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });
  return query.toString();
}

function normalizePath(pathname) {
  const value = String(pathname || '/').replace(/\/{2,}/g, '/');
  if (value.length > 1 && value.endsWith('/')) return value.slice(0, -1);
  return value;
}

function clean(value) {
  return String(value ?? '').trim();
}

function cleanMultiline(value, maxLength) {
  const result = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .trim();
  return result.slice(0, maxLength);
}

function clampInt(value, minimum, maximum, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function safeEqual(left, right) {
  const a = String(left);
  const b = String(right);
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
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

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: responseHeaders()
  });
}

function errorResponse(error) {
  const status =
    error instanceof HttpError
      ? error.status
      : 500;
  const code =
    error instanceof HttpError
      ? error.code
      : 'INTERNAL_ERROR';
  const message =
    error instanceof HttpError
      ? error.message
      : 'サーバーでエラーが発生しました。';

  if (!(error instanceof HttpError)) {
    console.error(error);
  }

  return json(
    {
      ok: false,
      error: {
        code,
        message,
        detail:
          error instanceof HttpError
            ? error.detail || null
            : null
      },
      message,
      version: VERSION
    },
    status
  );
}

function safeErrorMessage(error) {
  return error instanceof Error
    ? error.message
    : String(error || '不明なエラー');
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
