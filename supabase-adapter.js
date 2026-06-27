(() => {
  'use strict';

  const ENDPOINT = 'https://czaxtwbmborxwzaboqxl.supabase.co/functions/v1/acquisition-huddle';
  const nativeFetch = window.fetch.bind(window);
  const CACHE_TTL_MS = 15000;

  let cachedPayload = null;
  let cachedAt = 0;
  let pendingRequest = null;

  const arr = value => Array.isArray(value) ? value : [];
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const text = (value, fallback = '') => String(value ?? '').trim() || fallback;
  const key = value => text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function lastBusinessDayLabel() {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Riyadh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short'
    });
    const parts = Object.fromEntries(formatter.formatToParts(new Date()).map(part => [part.type, part.value]));
    const date = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
    const subtract = parts.weekday === 'Sun' ? 3 : parts.weekday === 'Sat' ? 2 : 1;
    date.setUTCDate(date.getUTCDate() - subtract);
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC'
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
      contacts: {
        ...(outreach.contacts || {}),
        total,
        contacted,
        notContacted,
        contactedRate: total ? Math.round((contacted / total) * 100) : 0,
        notContactedList
      },
      sourceSplit: {
        online: sourceSummary('online'),
        offline: sourceSummary('offline')
      },
      byRep: currentByRep
    };

    payload.meta = {
      ...(payload.meta || {}),
      yesterdayLabel: lastBusinessDayLabel(),
      dataSource: 'Supabase · corrected acquisition cache'
    };

    payload.diagnostics = {
      ...(payload.diagnostics || {}),
      adapterVersion: '3.0',
      acquisitionOnly: true,
      rankMeetingRowsRestored: true
    };

    return payload;
  }

  async function loadFromSupabase(force = false) {
    if (!force && cachedPayload && Date.now() - cachedAt < CACHE_TTL_MS) return cachedPayload;
    if (!force && pendingRequest) return pendingRequest;

    pendingRequest = nativeFetch(`${ENDPOINT}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    })
      .then(async response => {
        if (!response.ok) throw new Error(`Supabase dashboard request failed with HTTP ${response.status}`);
        const payload = await response.json();
        if (!payload || typeof payload !== 'object') throw new Error('Supabase returned an invalid dashboard payload.');
        if (payload.error) throw new Error(String(payload.error));

        cachedPayload = normalizePayload(payload);
        cachedAt = Date.now();
        return cachedPayload;
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
