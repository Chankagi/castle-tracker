(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CastleCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEY = 'castleTracker.v2';
  const LEGACY = 'castleTracker.legacyBackup';
  const PREVIOUS = 'castleTracker.previous';
  const blank = () => ({ version: 2, owner: null, visits: {}, plans: {} });
  const clone = value => JSON.parse(JSON.stringify(value));
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
  }
  const sameState = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const id = value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 200;
  const text = (value, limit) => typeof value === 'string' && value.length <= limit;
  function stampOK(s) {
    return object(s) && Number.isSafeInteger(s.n) && s.n >= 0 && s.n < 1e12 && /^[a-zA-Z0-9_-]{1,80}$/.test(s.d);
  }
  function validate(state) {
    if (!object(state) || state.version !== 2 || !object(state.visits) || !object(state.plans) ||
        !(state.owner === null || /^[a-f0-9-]{36}$/.test(state.owner))) throw Error('対応していない記録形式です。元の記録は変更していません。');
    if (Object.keys(state.visits).length > 200 || Object.keys(state.plans).length > 1000) throw Error('記録件数が上限を超えています。');
    for (const [key, v] of Object.entries(state.visits)) {
      if (!id(key) || String(Number(key)) !== key || !object(v) || !stampOK(v.s) ||
          !(v.date === null || (text(v.date, 40) && v.date.length > 0))) throw Error('訪問記録の形式を確認してください。');
    }
    for (const [key, p] of Object.entries(state.plans)) {
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key) ||
          !object(p) || !stampOK(p.s) || !text(p.name, 100) || !text(p.date, 10) ||
          (p.date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) || !text(p.origin, 200) ||
          typeof p.deleted !== 'boolean' || !Array.isArray(p.stops) || p.stops.length > 200 ||
          p.stops.some(n => !Number.isInteger(n) || !id(n)) || new Set(p.stops).size !== p.stops.length) {
        throw Error('ドライブプランの形式を確認してください。');
      }
    }
    return clone(state);
  }
  function compare(a, b) {
    return a.s.n - b.s.n || (a.s.d < b.s.d ? -1 : a.s.d > b.s.d ? 1 : 0);
  }
  function merge(a, b) {
    a = validate(a); b = validate(b);
    if (a.owner && b.owner && a.owner !== b.owner) throw Error('別アカウントの記録は混ぜられません。');
    const out = blank(); out.owner = a.owner || b.owner;
    for (const section of ['visits', 'plans']) {
      out[section] = { ...a[section] };
      for (const [key, incoming] of Object.entries(b[section])) {
        const old = out[section][key];
        if (!old || compare(incoming, old) > 0) out[section][key] = incoming;
        // Equal migration stamps can contain dates from different devices: keep a deterministic value.
        else if (section === 'visits' && incoming.s.n === 0 && compare(incoming, old) === 0 && (incoming.date || '') > (old.date || '')) out[section][key] = incoming;
      }
    }
    return validate(out);
  }
  function nextStamp(state, device) {
    return { n: Math.max(0, ...Object.values(state.visits).map(v => v.s.n), ...Object.values(state.plans).map(p => p.s.n)) + 1, d: device };
  }
  function hash(str) {
    let n = 2166136261;
    for (let i = 0; i < str.length; i++) n = Math.imul(n ^ str.charCodeAt(i), 16777619);
    return (n >>> 0).toString(16);
  }
  function migrate(visited, plans, device = 'legacy') {
    const state = blank();
    if (!object(visited) || !Array.isArray(plans)) throw Error('以前の記録形式を読み取れません。バックアップから確認してください。');
    for (const [key, date] of Object.entries(visited)) {
      if (!id(key) || !text(date, 40) || !date) throw Error('以前の訪問記録に読み取れない値があります。');
      state.visits[String(Number(key))] = { date, s: { n: 0, d: 'legacy' } };
    }
    const stops = plans.map(p => Number(object(p) ? p.number : p));
    if (stops.some(n => !id(n))) throw Error('以前のプランに読み取れない城番号があります。');
    if (stops.length) state.plans['legacy-' + hash(stops.join(',')) + '-' + device] = {
      name: '引き継いだドライブプラン', date: '', origin: '', stops: [...new Set(stops)], deleted: false, s: { n: 0, d: device }
    };
    return validate(state);
  }
  function load(storage, device) {
    const current = storage.getItem(KEY);
    if (current !== null) return validate(JSON.parse(current));
    const raw = { visited: storage.getItem('visited'), travelPlan: storage.getItem('travelPlan') };
    // A failed backup MUST abort migration. Never overwrite the old keys.
    if (storage.getItem(LEGACY) === null) storage.setItem(LEGACY, JSON.stringify({ savedAt: new Date().toISOString(), ...raw }));
    const state = migrate(raw.visited === null ? {} : JSON.parse(raw.visited), raw.travelPlan === null ? [] : JSON.parse(raw.travelPlan), device);
    storage.setItem(KEY, JSON.stringify(state));
    return state;
  }
  function save(storage, state) {
    const valid = validate(state);
    const old = storage.getItem(KEY);
    if (old !== null && old !== JSON.stringify(valid)) storage.setItem(PREVIOUS, old);
    storage.setItem(KEY, JSON.stringify(valid));
    return valid;
  }
  function importBackup(value, device) {
    if (value?.format === 'castle-tracker-backup' && value.state) return validate(value.state);
    if (value?.version === 2) return validate(value);
    if (object(value) && (typeof value.visited === 'string' || value.visited === null) && (typeof value.travelPlan === 'string' || value.travelPlan === null)) {
      return migrate(value.visited === null ? {} : JSON.parse(value.visited), value.travelPlan === null ? [] : JSON.parse(value.travelPlan), device);
    }
    if (object(value) && object(value.visited) && Array.isArray(value.travelPlan)) return migrate(value.visited, value.travelPlan, device);
    throw Error('訪城記のバックアップJSONを選んでください。');
  }
  function candidates(castles, query) {
    query = query.normalize('NFKC').trim().toLowerCase();
    if (!query) return [];
    const exact = castles.filter(c => c.name.toLowerCase() === query || String(c.number) === query);
    return exact.length ? exact : castles.filter(c => c.name.toLowerCase().includes(query) || c.prefecture.includes(query));
  }
  function routes(plan, castles) {
    if (!plan.stops.length) return [];
    const byId = new Map(castles.map(c => [c.number, c]));
    const points = plan.stops.map(n => { const c = byId.get(n); if (!c) throw Error('城が見つかりません。'); return `${c.lat},${c.lng}`; });
    if (plan.origin.trim()) points.unshift(plan.origin.trim());
    // At most 3 waypoints per URL for mobile browsers. Each segment shares its end/start.
    if (points.length === 1) return [{ label: 'この城まで車で移動', url: 'https://www.google.com/maps/dir/?' + new URLSearchParams({ api: '1', destination: points[0], travelmode: 'driving' }) }];
    const out = [];
    for (let start = 0; start < points.length - 1; start += 4) {
      const part = points.slice(start, start + 5);
      const params = new URLSearchParams({ api: '1', origin: part[0], destination: part.at(-1), travelmode: 'driving' });
      if (part.length > 2) params.set('waypoints', part.slice(1, -1).join('|'));
      out.push({ label: `区間${out.length + 1}をGoogleマップで開く`, url: 'https://www.google.com/maps/dir/?' + params });
    }
    return out;
  }
  return { KEY, LEGACY, PREVIOUS, blank, clone, validate, merge, sameState, nextStamp, load, save, migrate, importBackup, candidates, routes };
});
