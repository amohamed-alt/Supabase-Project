(() => {
  'use strict';

  const ENDPOINT = 'https://czaxtwbmborxwzaboqxl.supabase.co/functions/v1/acquisition-huddle';
  const STORAGE_KEY = 'talentera-acq-dashboard-v4';
  const MEMORY_TTL_MS = 5 * 60 * 1000;
  const PERSIST_TTL_MS = 24 * 60 * 60 * 1000;
  const nativeFetch = window.fetch.bind(window);

  let cachedPayload = null;
  let cachedAt = 0;
  let pendingRequest = null;

  const arr = value => Array.isArray(value) ? value : [];
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const text = (value, fallback = '') => String(value ?? '').trim() || fallback;
  const key = value => text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function restorePersistentCache() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved?.payload || !saved?.savedAt) return;
      if (Date.now() - Number(saved.savedAt) > PERSIST_TTL_MS) return;
      cachedPayload = saved.payload;
      cachedAt = Number(saved.savedAt);
    } catch (_) {}
  }

  function persist(payload) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ payload, savedAt: Date.now() }));
    } catch (_) {}
  }

  function lastBusinessDayLabel() {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
    });
    const parts = Object.fromEntries(formatter.formatToParts(new Date()).map(part => [part.type, part.value]));
    const date = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (parts.weekday === 'Sun' ? 3 : parts.weekday === 'Sat' ? 2 : 1));
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'long', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'
    }).format(date);
  }

  function normalizePayload(payload) {
    const reps = arr(payload.repData);
    const fullReps = reps.filter(rep => rep.type !== 'view');
    const allowedNames = new Set(fullReps.map(rep => key(rep.name)));
    const allowedFirstNames = new Set(fullReps.map(rep => key(rep.name).split(' ')[0]));
    const belongsToAcquisition = row => {
      const owner = key(row?.ownerName || row?.rep || row?.owner);
      return allowedNames.has(owner) || allowedFirstNames.has(owner.split(' ')[0]);
    };

    const companyCountry = new Map();
    for (const rep of reps) {
      for (const row of [...arr(rep.rankACompanies), ...arr(rep.rankBCompanies)]) {
        const company = key(row.companyName || row.name);
        const country = text(row.country, 'Unknown');
        if (company && country !== 'Unknown') companyCountry.set(company, country);
      }
      rep.rankAMeetingRows = arr(rep.rankACompanies).filter(row => num(row.completedMeetings) > 0);
      rep.rankBMeetingRows = arr(rep.rankBCompanies).filter(row => num(row.completedMeetings) > 0);
      rep.rankMeetingRows = [...rep.rankAMeetingRows, ...rep.rankBMeetingRows];
    }

    const outreach = payload.outreachCoverage || {};
    const currentByRep = arr(outreach.byRep).filter(item => {
      const name = key(item.name);
      return allowedNames.has(name) || allowedFirstNames.has(name.split(' ')[0]);
    });
    const sumSummary = (items, section, metric) => items.reduce((total, item) => {
      const source = section ? item?.sourceSplit?.[section] : item?.contacts;
      return total + num(source?.[metric]);
    }, 0);
    const notContactedList = arr(outreach.contacts?.notContactedList)
      .filter(belongsToAcquisition)
      .map(row => {
        if (text(row.country, 'Unknown') !== 'Unknown') return row;
        const country = companyCountry.get(key(row.companyName || row.company));
        return country ? { ...row, country } : row;
      });
    const total = sumSummary(currentByRep, null, 'total');
    const contacted = sumSummary(currentByRep, null, 'contacted');
    const notContacted = sumSummary(currentByRep, null, 'notContacted') || notContactedList.length;
    const sourceSummary = section => ({
      total: sumSummary(currentByRep, section, 'total'),
      contacted: sumSummary(currentByRep, section, 'contacted'),
      notContacted: sumSummary(currentByRep, section, 'notContacted')
    });

    payload.outreachCoverage = {
      ...outreach,
      contacts: { ...(outreach.contacts || {}), total, contacted, notContacted,
        contactedRate: total ? Math.round((contacted / total) * 100) : 0, notContactedList },
      sourceSplit: { online: sourceSummary('online'), offline: sourceSummary('offline') },
      byRep: currentByRep
    };
    payload.meta = { ...(payload.meta || {}), yesterdayLabel: lastBusinessDayLabel(),
      dataSource: 'Supabase · corrected cached acquisition data' };
    payload.diagnostics = { ...(payload.diagnostics || {}), adapterVersion: '4.0', acquisitionOnly: true,
      rankMeetingRowsRestored: true, persistentCache: true };
    return payload;
  }

  async function fetchFresh() {
    if (pendingRequest) return pendingRequest;
    pendingRequest = nativeFetch(ENDPOINT, { cache: 'default', headers: { Accept: 'application/json' } })
      .then(async response => {
        if (!response.ok) throw new Error(`Supabase dashboard request failed with HTTP ${response.status}`);
        const payload = await response.json();
        if (!payload || typeof payload !== 'object' || payload.error) throw new Error(String(payload?.error || 'Invalid dashboard payload'));
        cachedPayload = normalizePayload(payload);
        cachedAt = Date.now();
        persist(cachedPayload);
        window.dispatchEvent(new CustomEvent('talentera-dashboard-updated', { detail: cachedPayload }));
        return cachedPayload;
      })
      .finally(() => { pendingRequest = null; });
    return pendingRequest;
  }

  async function loadFromSupabase(force = false) {
    const freshEnough = cachedPayload && Date.now() - cachedAt < MEMORY_TTL_MS;
    if (!force && freshEnough) return cachedPayload;
    if (!force && cachedPayload) {
      fetchFresh().catch(() => {});
      return cachedPayload;
    }
    return fetchFresh();
  }

  restorePersistentCache();

  window.TalenteraSupabase = Object.freeze({
    endpoint: ENDPOINT,
    refresh: () => fetchFresh(),
    clearCache: () => {
      cachedPayload = null; cachedAt = 0;
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    }
  });

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (/(^|\/)data\.json(?:[?#]|$)/i.test(url)) {
      const requestsRefresh = /[?&](?:dealMovement|rankCoverage)=/i.test(url);
      const payload = await loadFromSupabase(requestsRefresh);
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=300',
          'X-Talentera-Data-Source': cachedAt && Date.now() - cachedAt > MEMORY_TTL_MS ? 'Supabase-Stale' : 'Supabase-Cache' }
      });
    }
    return nativeFetch(input, init);
  };
})();