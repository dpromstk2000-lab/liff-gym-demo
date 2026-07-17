window.DPRO_GYM_CONFIG = Object.freeze({
  workerBaseUrl: "https://dpro-gym-line-api.dpromstk2000.workers.dev",
  facilityCode: "dpro_gym_demo",
  demoAdminCode: "1234",
  version: "GYM-6-R1-CONFIG-DEMO-HEADER-FIX-20260717"
});

/*
 * STEP GYM-6-R1
 * Browser-safe demo prepare transport fix
 *
 * The existing pages include a Japanese value in X-Demo-Confirm.
 * Some browsers reject non ISO-8859-1 header values before fetch is sent.
 * The Worker also accepts body.confirm_text, so this shim removes only the
 * invalid custom header and preserves the JSON body confirmation text.
 */
(() => {
  "use strict";

  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  if (window.__DPRO_GYM_FETCH_HEADER_FIX__) return;

  const nativeFetch = window.fetch.bind(window);

  const containsNonLatin1 = (value) => {
    for (const character of String(value ?? "")) {
      if (character.codePointAt(0) > 255) return true;
    }
    return false;
  };

  const isDemoConfirmHeader = (name) =>
    String(name ?? "").toLowerCase() === "x-demo-confirm";

  const sanitizeHeaders = (headers) => {
    if (!headers) return headers;

    if (typeof Headers !== "undefined" && headers instanceof Headers) {
      const next = new Headers(headers);
      const value = next.get("X-Demo-Confirm");
      if (value && containsNonLatin1(value)) next.delete("X-Demo-Confirm");
      return next;
    }

    if (Array.isArray(headers)) {
      return headers.filter(([name, value]) =>
        !(isDemoConfirmHeader(name) && containsNonLatin1(value))
      );
    }

    if (typeof headers === "object") {
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
