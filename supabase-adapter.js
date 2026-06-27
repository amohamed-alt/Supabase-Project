(() => {
  'use strict';

  const ENDPOINT = 'https://czaxtwbmborxwzaboqxl.supabase.co/functions/v1/acquisition-huddle';
  const nativeFetch = window.fetch.bind(window);
  const CACHE_TTL_MS = 15000;

  let cachedPayload = null;
  let cachedAt = 0;
  let pendingRequest = null;

  async function loadFromSupabase(force = false) {
    if (!force && cachedPayload && Date.now() - cachedAt < CACHE_TTL_MS) {
      return cachedPayload;
    }

    if (!force && pendingRequest) return pendingRequest;

    pendingRequest = nativeFetch(`${ENDPOINT}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    })
      .then(async response => {
        if (!response.ok) {
          throw new Error(`Supabase dashboard request failed with HTTP ${response.status}`);
        }

        const payload = await response.json();
        if (!payload || typeof payload !== 'object') {
          throw new Error('Supabase returned an invalid dashboard payload.');
        }
        if (payload.error) throw new Error(String(payload.error));

        cachedPayload = payload;
        cachedAt = Date.now();
        return payload;
      })
      .finally(() => {
        pendingRequest = null;
      });

    return pendingRequest;
  }

  window.TalenteraSupabase = Object.freeze({
    endpoint: ENDPOINT,
    refresh: () => loadFromSupabase(true),
    clearCache: () => {
      cachedPayload = null;
      cachedAt = 0;
    }
  });

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';

    if (/(^|\/)data\.json(?:[?#]|$)/i.test(url)) {
      const requestsRefresh = /[?&](?:t|dealMovement|rankCoverage)=/i.test(url);
      const force = requestsRefresh && Date.now() - cachedAt >= CACHE_TTL_MS;
      const payload = await loadFromSupabase(force);

      return new Response(JSON.stringify(payload), {
        status: 200,
        statusText: 'OK',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Talentera-Data-Source': 'Supabase'
        }
      });
    }

    return nativeFetch(input, init);
  };
})();
