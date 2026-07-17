/* STEP GYM-6-R2 / DPRO パーソナルジム LINE */
window.DPRO_GYM_CONFIG = Object.freeze({
  version: 'GYM-6-R2-CONFIG-RESTORE-URL-HEADER-FIX-20260717',
  facilityCode: 'dpro_gym_demo',
  workerBaseUrl: 'https://dpro-gym-line-api.dpromstk2000.workers.dev',
  publicSiteUrl: 'https://dpromstk2000-lab.github.io/liff-gym-demo/',
  demoAdminCode: '1234',
  timezone: 'Asia/Tokyo',
  slotMinutes: 30
});

/*
 * Browser-safe demo prepare transport fix.
 *
 * Existing screens may include Japanese text in X-Demo-Confirm.
 * Browsers reject non-Latin-1 header values before sending the request.
 * The Worker also reads body.confirm_text, so remove only the invalid
 * custom header while preserving the JSON confirmation body.
 */
(() => {
  'use strict';

  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  if (window.__DPRO_GYM_FETCH_HEADER_FIX__) return;

  const nativeFetch = window.fetch.bind(window);

  const containsNonLatin1 = value => {
    for (const character of String(value ?? '')) {
      if (character.codePointAt(0) > 255) return true;
    }
    return false;
  };

  const isDemoConfirmHeader = name =>
    String(name ?? '').toLowerCase() === 'x-demo-confirm';

  const sanitizeHeaders = headers => {
    if (!headers) return headers;

    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
      const next = new Headers(headers);
      const value = next.get('X-Demo-Confirm');
      if (value && containsNonLatin1(value)) next.delete('X-Demo-Confirm');
      return next;
    }

    if (Array.isArray(headers)) {
      return headers.filter(([name, value]) =>
        !(isDemoConfirmHeader(name) && containsNonLatin1(value))
      );
    }

    if (typeof headers === 'object') {
      const next = {};
      Object.entries(headers).forEach(([name, value]) => {
        if (isDemoConfirmHeader(name) && containsNonLatin1(value)) return;
        next[name] = value;
      });
      return next;
    }

    return headers;
  };

  window.fetch = (input, init) => {
    if (!init || !init.headers) return nativeFetch(input, init);

    return nativeFetch(input, {
      ...init,
      headers: sanitizeHeaders(init.headers)
    });
  };

  window.__DPRO_GYM_FETCH_HEADER_FIX__ = true;
})();
