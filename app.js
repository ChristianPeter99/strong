/* Kraftzyklus – Kraft-Masse-Kalkulation als Web-App.
   Alle Daten bleiben lokal auf dem Gerät (localStorage). Kein Netzwerkzugriff außer App-Updates. */
'use strict';
(() => {
  const APP_VERSION = '1.5.0';
  const STORE_KEY = 'kraftzyklus.v1';
  const CYCLES = 10;
  const BAR = 20;
  const PLATES = [20, 15, 10, 5, 2.5, 1.25];
  const PLATE_LOOK = { 20: ['#3D6FB6', 56], 15: ['#C9A23A', 50], 10: ['#3F8A55', 44], 5: ['#D9DCE0', 34], 2.5: ['#C0504D', 28], 1.25: ['#8A9099', 22] };
  const REP_MIN = 8, REP_MAX = 10;      // Formel am genauesten bei 9 ± 1 Wdh.
  const MISS_LIMIT = 2;                 // ab 2× „nicht geschafft“ im Zyklus: Steigerung aussetzen vorschlagen
  const DAY = 86400000;

  // Plan aus der Kalkulationstabelle (Prozent vom 1RM, Sätze × Wdh.), Reihenfolge = deine Trainingswoche
  const LIFTS = [
    { id: 'bench', name: 'Bankdrücken', short: 'Bank', inc: 2.5, color: '#C6F432', plan: [[75, '5 × 8'], [70, '3 × 12'], [80, '6 × 6'], [85, '8 × 3']] },
    { id: 'squat', name: 'Kniebeuge', short: 'Knie', inc: 5, color: '#E879B9', plan: [[70, '3 × 12'], [75, '5 × 8'], [85, '8 × 3'], [80, '6 × 6']] },
    { id: 'ohp', name: 'Schulterdrücken', short: 'Schulter', inc: 2.5, color: '#FF9F43', plan: [[80, '6 × 6'], [85, '8 × 3'], [75, '5 × 8'], [70, '3 × 12']] },
    { id: 'dead', name: 'Kreuzheben', short: 'Kreuz', inc: 5, color: '#5BC0FF', plan: [[85, '8 × 3'], [80, '6 × 6'], [70, '3 × 12'], [75, '5 × 8']] }
  ];
  const LIFT = Object.fromEntries(LIFTS.map((l) => [l.id, l]));
  const DELOAD = [60, '4 × 8'];

  // ---------- Rechnen ----------
  const mround = (v) => Math.round(v / 2.5 + 1e-9) * 2.5;                 // Excel MROUND(x; 2,5)
  const oneRM = (kg, reps) => mround(kg * reps * 0.033 + kg);            // Excel: MROUND((0,033·Wdh)·kg + kg; 2,5)
  const fmt = (n) => (Math.round(n * 100) / 100).toString().replace('.', ',');
  const planOf = (id, w) => (w === 4 ? DELOAD : LIFT[id].plan[w]);

  function cur() { return S.rounds[S.rounds.length - 1]; }
  const hasTest = (id) => !!cur().test[id];
  function orm(id, c) {
    if (!hasTest(id)) return 0;
    let v = cur().test[id].orm;
    for (let k = 2; k <= c; k++) if (!S.skips[id].includes(k)) v += S.inc[id];
    return v;
  }
  function target(id, c, w) {
    const [pct, scheme] = planOf(id, w);
    const o = orm(id, c);
    return { pct, scheme, orm: o, kg: mround(o * pct / 100) };
  }
  function plates(kg) {
    let side = (kg - BAR) / 2;
    if (side < -1e-9) return null;
    const out = [];
    for (const p of PLATES) while (side >= p - 1e-9) { out.push(p); side -= p; }
    return out;
  }
  function warmups(kg) {
    const sets = [];
    const a = Math.max(BAR, mround(kg * 0.5)), b = Math.max(BAR, mround(kg * 0.75));
    if (a < kg) sets.push([a, 8]);
    if (b < kg && b !== a) sets.push([b, 3]);
    if (!sets.length && kg > BAR) sets.push([BAR, 10]);
    return sets;
  }
  const posKey = (c, w, r) => (r || S.round) + '-' + c + '-' + w;
  const cmpPos = (a, b) => (a.c - b.c) * 10 + (a.w - b.w);
  function entry(c, w, id, r) { const e = S.log[posKey(c, w, r)]; return (e && e[id]) || {}; }
  function setEntry(c, w, id, patch) {
    const k = posKey(c, w);
    S.log[k] = S.log[k] || {};
    S.log[k][id] = Object.assign({}, S.log[k][id], patch);
    if (!S.log[k][id].s && !S.log[k][id].note) delete S.log[k][id];
    if (!Object.keys(S.log[k]).length) delete S.log[k];
  }
  const weekName = (w) => (w === 4 ? 'Deload-Woche' : 'Woche ' + (w + 1));
  const weekShort = (w) => (w === 4 ? 'Deload' : 'Woche ' + (w + 1));
  const dateDE = (t) => new Date(t).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
  const daysAgo = (t) => Math.floor((Date.now() - t) / DAY);

  // ---------- Speicher ----------
  function newRound(n) { return { n, date: Date.now(), test: Object.fromEntries(LIFTS.map((l) => [l.id, null])) }; }
  function blank() {
    return {
      v: 1, setup: true, round: 1, rounds: [newRound(1)],
      inc: Object.fromEntries(LIFTS.map((l) => [l.id, l.inc])),
      skips: Object.fromEntries(LIFTS.map((l) => [l.id, []])),
      pos: { c: 1, w: 0 }, roundDone: false, log: {},
      lastBackup: null, backupSnooze: 0, createdAt: Date.now(), lastActive: Date.now(), body: []
    };
  }
  function valid(d) {
    try { return validInner(d); } catch (e) { return false; }
  }
  function validInner(d) {
    return !!(d && d.v === 1 && Array.isArray(d.rounds) && d.inc && d.skips && d.pos && typeof d.log === 'object' &&
      LIFTS.every((l) => typeof d.inc[l.id] === 'number' && Array.isArray(d.skips[l.id])) &&
      d.rounds.every((r) => r && r.test && LIFTS.every((l) => r.test[l.id] === null || r.test[l.id] === undefined || typeof r.test[l.id].orm === 'number')));
  }
  function migrate(d) {
    if (!d.rounds.length) { d.rounds = [newRound(1)]; d.round = 1; }
    d.rounds.forEach((r) => LIFTS.forEach((l) => { if (r.test[l.id] === undefined) r.test[l.id] = null; }));
    d.setup = true;
    if (!Array.isArray(d.body)) d.body = [];
    d.body = d.body.filter((b) => b && /^\d{4}-\d{2}-\d{2}$/.test(b.d) && typeof b.kg === 'number').sort((x, y) => (x.d < y.d ? -1 : 1));
    return d;
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return blank();
      const d = JSON.parse(raw);
      return valid(d) ? migrate(d) : blank();
    } catch (e) { return blank(); }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
    catch (e) { toast('Speichern fehlgeschlagen – Speicher voll?'); }
  }
  let S = load();

  // ---------- UI-Zustand (nicht gespeichert) ----------
  const V = { tab: 'woche', sub: null, wk: null, lift: null, planC: null, planView: -1, update: 'idle', changed: [], updError: '' };

  // ---------- DOM-Helfer ----------
  const SVGNS = 'http://www.w3.org/2000/svg';
  function h(tag, props, ...kids) {
    const isSvg = tag.startsWith('svg:');
    const el = isSvg ? document.createElementNS(SVGNS, tag.slice(4)) : document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') Object.assign(el.style, v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const ICONS = {
    chevL: ['M15 6l-6 6 6 6'], chevR: ['M9 6l6 6-6 6'], check: ['M5 12.5l4.5 4.5L19 7.5'], x: ['M7 7l10 10M17 7L7 17'],
    week: ['M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12'],
    plan: ['M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM4 10h16M9 3v4M15 3v4'],
    kraft: ['M12 3v18M5 8l7-5 7 5M7 21h10'], verlauf: ['M4 19l5-6 4 3 7-9M4 4v15h16'],
    gear: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
    down: ['M12 3v12M7 10l5 5 5-5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2'],
    up: ['M12 15V3M7 8l5-5 5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2'],
    refresh: ['M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6'],
    note: ['M5 4h10l4 4v12H5zM14 4v5h5M8 13h8M8 17h5'],
    repeat: ['M4 12a8 8 0 0 1 14-5.3M20 4v5h-5M20 12a8 8 0 0 1-14 5.3M4 20v-5h5'],
    shield: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'M9 12l2 2 4-4'],
    alert: ['M12 3l10 18H2z', 'M12 10v4M12 17.5v.5'],
    trophy: ['M8 4h8v5a4 4 0 0 1-8 0z', 'M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9.5 17h5v4h-5z'],
    pause: ['M10 15V9M14 15V9', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z']
  };
  function icon(name, cls) {
    return h('svg:svg', { class: cls || 'i', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, ICONS[name].map((d) => h('svg:path', { d })));
  }

  let toastTimer;
  function toast(msg, undo) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = h('div', { class: 'toast', role: 'status' }, h('span', { text: msg }),
      undo ? h('button', { type: 'button', text: 'Rückgängig', onclick: () => { clearTimeout(toastTimer); t.remove(); undo(); } }) : null);
    document.body.append(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), undo ? 6000 : 2600);
  }
  // Zustand merken, um eine Aktion rückgängig machen zu können
  function snapshot() {
    const snap = JSON.stringify(S);
    return () => { S = JSON.parse(snap); save(); V.wk = null; render(); toast('Rückgängig gemacht'); };
  }

  // Bildschirm bleibt in der Übungsansicht an (sofern iOS es erlaubt)
  let wakeLock = null, wakeBusy = false;
  async function setWake(on) {
    if (!('wakeLock' in navigator) || wakeBusy) return;
    wakeBusy = true;
    try {
      if (on && !wakeLock && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) { const wl = wakeLock; wakeLock = null; await wl.release(); }
    } catch (e) { wakeLock = null; }
    wakeBusy = false;
  }

  function sheet(title, build) {
    const prev = document.activeElement;
    const ov = h('div', { class: 'overlay' });
    const sh = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    function close() { ov.remove(); document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); }
    sh.append(h('div', { class: 'grip' }), h('h2', { text: title }), build(close));
    ov.append(sh);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    document.addEventListener('keydown', onKey);
    document.body.append(ov);
    const f = sh.querySelector('input, textarea, button.primary, button');
    if (f) setTimeout(() => f.focus({ preventScroll: true }), 50);
    return close;
  }
  function confirmSheet(title, text, okLabel, danger) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v, close) => { if (!done) { done = true; close(); resolve(v); } };
      const close = sheet(title, (cl) => h('div', { class: 'stack' },
        h('p', { class: 'muted', text }),
        h('div', { class: 'btns' },
          h('button', { class: 'btn ghost', type: 'button', text: 'Abbrechen', onclick: () => finish(false, cl) }),
          h('button', { class: 'btn ' + (danger ? 'ghost' : 'primary'), style: danger ? { color: 'var(--bad)', borderColor: 'var(--bad)' } : null, type: 'button', text: okLabel, onclick: () => finish(true, cl) })
        )));
      // Schließen über Hintergrund/Escape = Abbrechen
      const obs = new MutationObserver(() => { if (!document.body.contains(document.querySelector('.overlay'))) { obs.disconnect(); if (!done) { done = true; resolve(false); } } });
      obs.observe(document.body, { childList: true });
      void close;
    });
  }

  // ---------- Navigation ----------
  function go(tab) { if (tab === 'plan' && V.tab !== 'plan') V.planC = null; V.tab = tab; V.sub = null; V.wk = tab === 'woche' ? V.wk : null; render(true); }
  function openSub(sub, extra) {
    Object.assign(V, extra || {});
    V.sub = sub;
    try { history.pushState({ sub }, ''); } catch (e) { /* egal */ }
    render(true);
  }
  function closeSub() { if (history.state && history.state.sub) history.back(); else { V.sub = null; render(true); } }
  window.addEventListener('popstate', () => { if (V.sub) { V.sub = null; render(true); } });

  const app = document.getElementById('app');
  function render(scrollTop) {
    app.replaceChildren();
    let screen;
    if (V.sub === 'lift') screen = renderLift();
    else if (V.sub === 'settings') screen = renderSettings();
    else screen = ({ woche: renderWoche, plan: renderPlan, kraft: renderKraft, verlauf: renderVerlauf })[V.tab]();
    app.append(screen);
    app.append(renderTabbar());
    setWake(V.sub === 'lift');
    if (scrollTop) window.scrollTo(0, 0);
  }

  function renderTabbar() {
    const tabs = [['woche', 'Woche', 'week'], ['plan', 'Plan', 'plan'], ['kraft', 'Kraftwerte', 'kraft'], ['verlauf', 'Verlauf', 'verlauf']];
    return h('nav', { class: 'tabbar', 'aria-label': 'Hauptnavigation' }, tabs.map(([id, label, ic]) => {
      const active = V.tab === id;
      const dot = id === 'plan' && V.update === 'available';
      return h('button', { type: 'button', 'aria-current': active ? 'page' : null, 'aria-label': dot ? label + ', Update verfügbar' : null, onclick: () => go(id) },
        h('span', { class: dot ? 'has-dot' : null, style: { display: 'inline-flex' } }, icon(ic)), label);
    }));
  }

  // ---------- Maximalkraft eintragen (pro Übung, an beliebigen Tagen) ----------
  const parseNum = (s) => { const n = parseFloat(String(s).replace(',', '.')); return isFinite(n) ? n : NaN; };
  function testSheet(id) {
    const l = LIFT[id];
    const t = cur().test[id];
    sheet(l.name + (t ? ' ändern' : ' eintragen'), (close) => {
      const kgIn = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': l.name + ': Gewicht in kg', value: t ? fmt(t.kg) : '', placeholder: '0' });
      const repIn = h('input', { class: 'reps', type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': l.name + ': Wiederholungen', value: t ? String(t.reps) : '', placeholder: '0' });
      const out = h('span', { class: 'orm empty', text: '0 kg' });
      const warn = h('p', { class: 'hint-warn', hidden: true });
      const saveBtn = h('button', { class: 'btn primary', type: 'button', text: 'Speichern', disabled: true });
      let inc = S.inc[id];
      const ok = () => { const kg = parseNum(kgIn.value), r = parseNum(repIn.value); return kg >= 1 && kg <= 500 && Number.isInteger(r) && r >= 1 && r <= 30; };
      const upd = () => {
        const r = parseNum(repIn.value);
        const outside = repIn.value.trim() !== '' && isFinite(r) && (r < REP_MIN || r > REP_MAX);
        warn.hidden = !outside;
        warn.textContent = r > REP_MAX ? 'Über ' + REP_MAX + ' Wdh. wird die Schätzung ungenau (eher zu niedrig).' : 'Unter ' + REP_MIN + ' Wdh. schätzt die Formel etwas zu hoch.';
        repIn.classList.toggle('warn', outside);
        if (ok()) { out.textContent = fmt(oneRM(parseNum(kgIn.value), r)) + ' kg'; out.classList.remove('empty'); }
        else { out.textContent = '0 kg'; out.classList.add('empty'); }
        saveBtn.disabled = !ok();
      };
      kgIn.addEventListener('input', upd); repIn.addEventListener('input', upd);
      saveBtn.addEventListener('click', () => {
        if (!ok()) return;
        const kg = parseNum(kgIn.value), reps = parseNum(repIn.value);
        cur().test[id] = { kg, reps, orm: oneRM(kg, reps), date: Date.now() };
        S.inc[id] = inc; S.lastActive = Date.now();
        save(); requestPersist(); close(); render();
        toast(l.name + ': Maximalkraft ' + fmt(cur().test[id].orm) + ' kg');
      });
      setTimeout(upd);
      return h('div', { class: 'stack' },
        h('p', { class: 'muted small', text: 'Gewicht wählen, mit dem du sauber ' + REP_MIN + '–' + REP_MAX + ' Wiederholungen bis kurz vor Muskelversagen schaffst – dort ist die Formel am genauesten. Mit Sicherung testen.' }),
        h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
          h('label', { class: 'field' }, kgIn, 'kg'), h('span', { class: 'muted', text: '×' }), h('label', { class: 'field' }, repIn, 'Wdh.'),
          h('span', { class: 'col', style: { marginLeft: 'auto', alignItems: 'flex-end', gap: '0' } }, h('span', { class: 'tiny muted', text: 'Maximalkraft' }), out)),
        warn,
        h('div', { class: 'row between' }, h('span', { class: 'small muted', text: 'Steigerung pro Zyklus' }),
          h('div', { class: 'seg dark', style: { minWidth: '112px' }, role: 'group', 'aria-label': 'Steigerung pro Zyklus' }, [2.5, 5].map((v) =>
            h('button', { type: 'button', 'aria-pressed': String(inc === v), text: '+' + fmt(v) + ' kg', onclick: (e) => {
              inc = v; e.currentTarget.parentNode.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
            } })))),
        h('div', { class: 'btns' }, h('button', { class: 'btn ghost', type: 'button', text: 'Abbrechen', onclick: close }), saveBtn));
    });
  }

  async function startNewRound() {
    if (!(await confirmSheet('Neue Runde starten?', S.roundDone
      ? 'Die nächste Runde beginnt bei Zyklus 1, Woche 1. Trag danach deine neuen Testwerte unter Kraftwerte ein – gern an verschiedenen Tagen. Dein Verlauf bleibt erhalten.'
      : 'Du bist in Zyklus ' + S.pos.c + '. Eine neue Runde beginnt bei Zyklus 1, Woche 1, alle Maximalkraftwerte stehen wieder auf 0 bis du neu getestet hast. Verlauf und Notizen bleiben erhalten.', 'Neue Runde'))) return;
    cur().finished = cur().finished || Date.now();
    const n = S.rounds.length + 1;
    S.rounds.push(newRound(n));
    S.round = n; S.pos = { c: 1, w: 0 }; S.roundDone = false;
    S.skips = Object.fromEntries(LIFTS.map((l) => [l.id, []]));
    save(); V.wk = null; V.planC = null; V.sub = null; V.tab = 'kraft'; render(true);
    toast('Runde ' + n + ' gestartet – jetzt Bestwerte eintragen');
  }

  // ---------- Woche ----------
  function backupDue() {
    if (Date.now() < S.backupSnooze || !LIFTS.some((l) => hasTest(l.id))) return null;
    if (!S.lastBackup) return Date.now() - S.createdAt > 7 * DAY ? 'Du hast noch kein Backup. Deine Daten liegen nur auf diesem iPhone.' : null;
    const d = daysAgo(S.lastBackup);
    return d >= 28 ? 'Dein letztes Backup ist ' + d + ' Tage alt.' : null;
  }

  function renderWoche() {
    const pos = S.pos;
    const vp = V.wk || pos;
    const rel = cmpPos(vp, pos);
    const isCurrent = rel === 0 && !S.roundDone;
    const kids = [];

    const canPrev = vp.c > 1 || vp.w > 0, canNext = vp.c < CYCLES || vp.w < 4;
    const step = (d) => {
      let { c, w } = vp; w += d;
      if (w > 4) { w = 0; c++; } if (w < 0) { w = 4; c--; }
      V.wk = { c, w }; render();
    };
    kids.push(h('div', { class: 'weekhead' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Vorherige Woche', disabled: !canPrev, onclick: () => step(-1) }, icon('chevL')),
      h('div', { class: 'title' }, h('span', { class: 'tiny muted', text: 'Runde ' + S.round + ' · Zyklus ' + vp.c + ' von ' + CYCLES }), h('h1', { text: weekName(vp.w) })),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Nächste Woche', disabled: !canNext, onclick: () => step(1) }, icon('chevR'))));

    kids.push(h('div', { class: 'segments', 'aria-hidden': 'true' }, [0, 1, 2, 3, 4].map((i) => {
      let cls = '';
      if (S.roundDone || vp.c < pos.c || (vp.c === pos.c && i < pos.w)) cls = 'done';
      else if (vp.c === pos.c && i === pos.w) cls = 'now';
      if (vp.c === pos.c && i === pos.w && S.roundDone) cls = 'done';
      return h('i', { class: cls });
    })));

    if (rel !== 0) kids.push(h('button', { class: 'chip', type: 'button', onclick: () => { V.wk = null; render(); } }, rel < 0 ? 'Abgeschlossen · zur aktuellen Woche' : 'Vorschau · zur aktuellen Woche'));

    if (S.roundDone && rel === 0) {
      kids.push(h('div', { class: 'card col', style: { gap: '10px', boxShadow: 'inset 0 0 0 1px var(--accent)' } },
        h('span', { class: 'accent' }, icon('trophy')),
        h('h2', { text: 'Runde ' + S.round + ' geschafft!' }),
        h('p', { class: 'muted small', text: '10 Zyklen durchgezogen. Teste jetzt deine neuen Bestwerte – daraus entsteht die nächste Runde. Dein bisheriger Verlauf bleibt erhalten.' }),
        h('button', { class: 'btn primary block', type: 'button', text: 'Neue Runde starten', onclick: startNewRound })));
    }

    if (isCurrent) {
      const due = backupDue();
      if (due) kids.push(h('div', { class: 'banner warn' }, h('span', { style: { color: 'var(--warn)' } }, icon('shield')),
        h('div', { class: 'grow' }, h('p', null, h('strong', { text: 'Backup empfohlen. ' }), due),
          h('div', { class: 'actions' },
            h('button', { class: 'btn primary small', type: 'button', text: 'Jetzt sichern', onclick: startBackup }),
            h('button', { class: 'btn ghost small', type: 'button', text: 'Später', onclick: () => { S.backupSnooze = Date.now() + 7 * DAY; save(); render(); } })))));
    }
    if (vp.w === 4) kids.push(h('div', { class: 'banner' }, h('span', { class: 'accent' }, icon('pause')), h('p', null, h('strong', { text: 'Deload: ' }), '60 % für alle Übungen. Locker bleiben, Technik sauber halten – danach steigen die Gewichte.')));

    const missing = LIFTS.filter((l) => !hasTest(l.id));
    if (missing.length) kids.push(h('div', { class: 'banner' }, h('span', { class: 'accent' }, icon('kraft')),
      h('div', { class: 'grow' }, h('p', null, h('strong', { text: missing.length === 4 ? 'Noch keine Maximalkraft eingetragen. ' : 'Noch offen: ' + missing.map((l) => l.name).join(', ') + '. ' }),
        'Trag deine Testwerte unter Kraftwerte ein – gern an verschiedenen Tagen.'),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary small', type: 'button', text: 'Zu Kraftwerte', onclick: () => go('kraft') })))));
    else if (isCurrent && !LIFTS.some((l) => entry(pos.c, pos.w, l.id).s) && !backupDue() && vp.w !== 4) kids.push(h('p', { class: 'tiny muted', style: { textAlign: 'center', margin: '-4px 0' }, text: 'Übung antippen, um sie als geschafft einzutragen' }));
    const next = isCurrent ? LIFTS.find((l) => hasTest(l.id) && !entry(pos.c, pos.w, l.id).s) : null;
    LIFTS.forEach((l) => kids.push(liftCard(l, vp, next === l)));

    if (isCurrent) {
      const states = LIFTS.map((l) => entry(pos.c, pos.w, l.id).s);
      const n = states.filter(Boolean).length;
      const label = pos.w === 4 ? (pos.c === CYCLES ? 'Runde abschließen' : 'Zyklus ' + pos.c + ' abschließen') : weekName(pos.w) + ' abschließen';
      kids.push(h('button', { class: 'btn ' + (n === 4 ? 'primary' : 'ghost') + ' block', type: 'button', onclick: async () => {
        if (n < 4) {
          const open = LIFTS.filter((l) => !entry(pos.c, pos.w, l.id).s).map((l) => l.name);
          if (!(await confirmSheet('Trotzdem abschließen?', (open.length === 1 ? open[0] + ' ist' : open.join(', ') + ' sind') + ' noch nicht eingetragen. Offene Übungen zählen beim Zyklusende wie „nicht geschafft“.', 'Abschließen'))) return;
        }
        finishWeek();
      } }, label, n < 4 ? h('span', { class: 'tiny', style: { opacity: '0.7', fontWeight: '500' }, text: '(' + n + ' von 4)' }) : null));
      kids.push(h('button', { class: 'link', type: 'button', style: { alignSelf: 'center' }, onclick: repeatSheet }, icon('repeat', 'i s'), 'Woche wiederholen …'));
    }
    const main = h('main', { class: 'screen' }, kids);
    // Wischen nach links/rechts blättert durch die Wochen
    let sx = 0, sy = 0;
    main.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    main.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) { if (dx < 0 && canNext) step(1); else if (dx > 0 && canPrev) step(-1); }
    }, { passive: true });
    return main;
  }

  function liftCard(l, vp, isNext) {
    const t = target(l.id, vp.c, vp.w);
    const e = entry(vp.c, vp.w, l.id);
    const pl = plates(t.kg);
    const skipped = vp.c > 1 && S.skips[l.id].includes(vp.c);
    const state = e.s === 'ok' ? 'Geschafft' : e.s === 'miss' ? 'Nicht geschafft' : 'Offen';
    return h('button', { class: 'lift' + (e.s === 'ok' ? ' is-ok' : e.s === 'miss' ? ' is-miss' : isNext ? ' is-next' : ''), type: 'button',
      'aria-label': l.name + ', ' + fmt(t.kg) + ' kg, ' + t.scheme + ', ' + state + (e.note ? ', mit Notiz' : ''),
      onclick: () => openSub('lift', { lift: { id: l.id, c: vp.c, w: vp.w, from: 'woche' } }) },
      h('span', { class: 'lift-top' },
        h('span', { class: 'lift-name' }, l.name, icon('chevR', 'i s')),
        h('span', { class: 'row', style: { gap: '10px' } },
          e.note ? h('span', { class: 'note-tag' }, icon('note', 'i s')) : null,
          e.s ? h('span', { class: 'badge ' + e.s }, icon(e.s === 'ok' ? 'check' : 'x', 'i s'), state) : isNext ? h('span', { class: 'badge next', text: 'Als Nächstes' }) : null)),
      h('span', { class: 'lift-main' },
        h('span', { class: 'col', style: { gap: '3px' } },
          h('span', { class: 'row', style: { alignItems: 'baseline', gap: '12px' } },
            h('span', { class: 'kg' }, fmt(t.kg), h('small', { text: ' kg' })), h('span', { class: 'scheme', text: t.scheme })),
          skipped ? h('span', { class: 'tiny', style: { color: 'var(--warn)' }, text: 'Steigerung in diesem Zyklus ausgesetzt' }) : null),
        hasTest(l.id) ? miniPlates(pl) : null));
  }

  function miniPlates(pl) {
    if (!pl) return null;
    return h('span', { class: 'plates', 'aria-hidden': 'true' }, h('span', { class: 'bar' }),
      pl.map((p) => h('span', { class: 'p', style: { height: Math.round(PLATE_LOOK[p][1] * 0.78) + 'px', background: PLATE_LOOK[p][0] } })));
  }

  function finishWeek() {
    const { c, w } = S.pos;
    const undo = snapshot();
    S.lastActive = Date.now();
    if (w < 4) { S.pos = { c, w: w + 1 }; save(); V.wk = null; render(true); toast(weekName(w) + ' abgeschlossen', undo); return; }
    // Zyklusende: verpasste Einheiten prüfen
    const flagged = LIFTS.map((l) => ({ l, miss: [0, 1, 2, 3].filter((wk) => entry(c, wk, l.id).s !== 'ok').length })).filter((x) => x.miss >= MISS_LIMIT);
    const advance = (skipIds) => {
      if (c === CYCLES) { S.roundDone = true; cur().finished = Date.now(); }
      else { skipIds.forEach((id) => { if (!S.skips[id].includes(c + 1)) S.skips[id].push(c + 1); }); S.pos = { c: c + 1, w: 0 }; }
      save(); V.wk = null; render(true);
      toast(c < CYCLES ? 'Zyklus ' + c + ' abgeschlossen' + (skipIds.length ? '' : ' – die Gewichte steigen') : 'Runde abgeschlossen', undo);
    };
    if (!flagged.length || c === CYCLES) { advance([]); return; }
    const picks = Object.fromEntries(flagged.map((x) => [x.l.id, true]));
    sheet('Steigerung aussetzen?', (close) => h('div', { class: 'stack' },
      h('p', { class: 'muted small', text: 'Bei diesen Übungen hast du in Zyklus ' + c + ' mehrmals „nicht geschafft“ eingetragen oder offen gelassen. Statt stur zu steigern, kannst du im nächsten Zyklus mit demselben Maximalkraftwert weitermachen.' }),
      flagged.map((x) => h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: true, onchange: (e) => { picks[x.l.id] = e.target.checked; } }),
        h('span', { class: 'grow' }, h('strong', { text: x.l.name }), h('span', { class: 'tiny muted', style: { display: 'block' }, text: x.miss + '× nicht geschafft oder offen · bleibt bei ' + fmt(orm(x.l.id, c)) + ' kg 1RM' })))),
      h('div', { class: 'btns' },
        h('button', { class: 'btn ghost', type: 'button', text: 'Abbrechen', onclick: close }),
        h('button', { class: 'btn primary', type: 'button', text: 'Weiter', onclick: () => { close(); advance(Object.keys(picks).filter((k) => picks[k])); } }))));
  }

  function repeatSheet() {
    const { c, w } = S.pos;
    const hasPrev = c > 1 || w > 0;
    sheet('Woche wiederholen', (close) => h('div', { class: 'stack' },
      h('p', { class: 'muted small', text: 'Krank, Urlaub oder einfach eine Woche verpasst? Wiederhole eine Woche, ohne dass der Plan durcheinanderkommt. Notizen bleiben erhalten.' }),
      h('button', { class: 'btn ghost block', type: 'button', onclick: () => {
        const undo = snapshot();
        LIFTS.forEach((l) => setEntry(c, w, l.id, { s: null })); save(); close(); render(); toast(weekName(w) + ' neu begonnen', undo);
      } }, 'Diese Woche neu beginnen'),
      hasPrev ? h('button', { class: 'btn ghost block', type: 'button', onclick: () => {
        const undo = snapshot();
        let pc = c, pw = w - 1;
        if (pw < 0) { pw = 4; pc = c - 1; LIFTS.forEach((l) => { S.skips[l.id] = S.skips[l.id].filter((k) => k !== c); }); }
        LIFTS.forEach((l) => { setEntry(c, w, l.id, { s: null }); setEntry(pc, pw, l.id, { s: null }); });
        S.pos = { c: pc, w: pw }; save(); close(); V.wk = null; render(true); toast('Zurück zu Zyklus ' + pc + ' · ' + weekShort(pw), undo);
      } }, 'Vorherige Woche nochmal machen') : null,
      h('button', { class: 'btn danger block', type: 'button', text: 'Abbrechen', onclick: close })));
  }

  // ---------- Übung ----------
  function lastNote(id, c, w) {
    for (let r = S.round; r >= 1; r--) {
      let pc = r === S.round ? c : CYCLES, pw = r === S.round ? w - 1 : 4;
      while (pc >= 1) {
        if (pw < 0) { pc--; pw = 4; continue; }
        const e = entry(pc, pw, id, r);
        if (e.note) return { note: e.note, c: pc, w: pw, r };
        pw--;
      }
    }
    return null;
  }

  function renderLift() {
    const { id, c, w } = V.lift;
    const l = LIFT[id];
    const t = target(id, c, w);
    const pl = plates(t.kg);
    const rel = S.roundDone ? -1 : cmpPos({ c, w }, S.pos);
    const editable = rel <= 0;
    const idx = LIFTS.findIndex((x) => x.id === id);
    const prevL = LIFTS[idx - 1], nextL = LIFTS[idx + 1];
    const switchTo = (nid) => { V.lift = Object.assign({}, V.lift, { id: nid }); render(true); };
    const notes = allNotes(id).filter((n) => !(n.r === S.round && n.c === c && n.w === w));
    const e = entry(c, w, id);
    const prev = lastNote(id, c, w);
    const setS = (s) => { setEntry(c, w, id, { s: entry(c, w, id).s === s ? null : s }); S.lastActive = Date.now(); save(); render(); };

    let saveTimer;
    const ta = h('textarea', { 'aria-label': 'Notiz für diese Woche', placeholder: 'z. B. Griff enger, Schulter zwickt, nächstes Mal Gürtel …', maxlength: '500', value: e.note || '' });
    const saveNote = () => { clearTimeout(saveTimer); setEntry(c, w, id, { note: ta.value.trim() }); save(); };
    ta.addEventListener('input', () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNote, 400); });
    ta.addEventListener('blur', saveNote);
    const quick = ['Lief gut', 'Zu schwer', 'Technik verbessern', 'Schmerzen'].map((q) => h('button', { type: 'button', text: '+ ' + q, onclick: () => {
      ta.value = (ta.value.trim() ? ta.value.trim() + ', ' : '') + q; saveNote(); ta.focus();
    } }));

    const fig = !hasTest(id) ? h('div', { class: 'banner' }, h('span', { class: 'accent' }, icon('kraft')),
      h('div', { class: 'grow' }, h('p', { text: 'Für ' + l.name + ' ist noch keine Maximalkraft eingetragen. Sobald du getestet hast, stehen hier Gewicht, Scheiben und Aufwärmsätze.' }),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary small', type: 'button', text: 'Jetzt eintragen', onclick: () => testSheet(id) }))))
      : pl ? h('figure', { class: 'card col', style: { margin: '0', gap: '8px' } },
      h('div', { class: 'plates big', role: 'img', 'aria-label': pl.length ? 'Pro Seite: ' + pl.map(fmt).join(' + ') + ' kg' : 'Nur die Stange' },
        pl.slice().reverse().map((p) => h('div', { class: 'p', style: { height: PLATE_LOOK[p][1] * 1.25 + 'px', background: PLATE_LOOK[p][0] } })),
        h('div', { class: 'collar' }), h('div', { class: 'shaft' }), h('div', { class: 'collar' }),
        pl.map((p) => h('div', { class: 'p', style: { height: PLATE_LOOK[p][1] * 1.25 + 'px', background: PLATE_LOOK[p][0] } }))),
      h('figcaption', { class: 'row between small' }, h('span', { class: 'muted', text: 'Pro Seite' }), h('strong', { text: (pl.length ? pl.map(fmt).join(' + ') + ' kg' : 'keine Scheiben') + ' · Stange 20 kg' })))
      : h('div', { class: 'banner' }, icon('alert'), h('p', { text: 'Das Zielgewicht liegt unter 20 kg – nimm eine leichtere Stange oder Kurzhanteln.' }));

    const warm = hasTest(id) ? warmups(t.kg) : [];
    return h('main', { class: 'screen' },
      h('button', { class: 'link', type: 'button', style: { alignSelf: 'flex-start' }, onclick: closeSub }, icon('chevL', 'i s'), V.lift.from === 'plan' ? 'Plan' : weekShort(w)),
      h('div', { class: 'col', style: { gap: '2px' } },
        h('span', { class: 'small muted', text: l.name + ' · Zyklus ' + c + ' · ' + weekShort(w) }),
        h('div', { class: 'row', style: { alignItems: 'baseline', gap: '14px' } },
          h('span', { class: 'hero-kg' }, fmt(t.kg), h('small', { text: ' kg' })), h('span', { class: 'scheme', style: { fontSize: '30px' }, text: t.scheme })),
        h('span', { class: 'small muted', text: hasTest(id) ? t.pct + ' % von ' + fmt(t.orm) + ' kg Maximalkraft' : t.pct + ' % deiner Maximalkraft – noch nicht eingetragen' })),
      fig,
      warm.length ? [h('div', { class: 'label', text: 'Aufwärmen' }),
        h('div', { class: 'warm' }, warm.map(([kg, r]) => h('div', null, h('span', { class: 'num', style: { fontSize: '24px' }, text: kg === BAR ? 'Stange' : fmt(kg) + ' kg' }), h('span', { class: 'muted small', text: '× ' + r }))))] : null,
      editable ? [h('div', { class: 'label', text: rel < 0 ? 'Ergebnis · nachträglich ändern' : 'Ergebnis' }), h('div', { class: 'status big' },
        h('button', { class: 'ok', type: 'button', 'aria-pressed': String(e.s === 'ok'), onclick: () => setS('ok') }, icon('check'), 'Geschafft'),
        h('button', { class: 'miss', type: 'button', 'aria-pressed': String(e.s === 'miss'), onclick: () => setS('miss') }, icon('x'), 'Nicht geschafft'))] : null,
      prev ? [h('div', { class: 'label', text: 'Notiz vom letzten Mal' }),
        h('div', { class: 'col', style: { gap: '4px' } }, h('div', { class: 'lastnote', text: prev.note }),
          h('span', { class: 'tiny muted', style: { paddingLeft: '4px' }, text: (prev.r !== S.round ? 'Runde ' + prev.r + ' · ' : '') + 'Zyklus ' + prev.c + ' · ' + weekShort(prev.w) }))] : null,
      h('div', { class: 'label', text: 'Notiz für diese Woche' }),
      ta,
      h('div', { class: 'quick' }, quick),
      h('p', { class: 'tiny muted', text: 'Wird automatisch gespeichert und beim nächsten ' + l.name + ' wieder angezeigt.' }),
      notes.length > 1 ? h('details', { class: 'notes' },
        h('summary', null, 'Alle Notizen zu ' + l.name + ' (' + notes.length + ')'),
        notes.map((n) => h('div', { class: 'note-item' },
          h('span', { class: 'tiny muted', text: (n.r !== S.round ? 'Runde ' + n.r + ' · ' : '') + 'Zyklus ' + n.c + ' · ' + weekShort(n.w) }),
          h('span', { class: 'small', text: n.note })))) : null,
      h('div', { class: 'pager' },
        prevL ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => switchTo(prevL.id) }, icon('chevL', 'i s'), prevL.name) : h('span'),
        nextL ? h('button', { class: 'btn ghost small right', type: 'button', onclick: () => switchTo(nextL.id) }, nextL.name, icon('chevR', 'i s')) : h('span'))
    );
  }

  function allNotes(id) {
    const out = [];
    for (let r = S.round; r >= 1; r--) for (let c = CYCLES; c >= 1; c--) for (let w = 4; w >= 0; w--) {
      const e = entry(c, w, id, r);
      if (e.note) out.push({ note: e.note, c, w, r });
    }
    return out;
  }

  // ---------- Plan ----------
  function renderPlan() {
    if (!V.planC) V.planC = S.pos.c;
    const c = V.planC, view = V.planView;
    const nowW = c === S.pos.c && !S.roundDone ? S.pos.w : -1;
    const tabs = [{ label: 'Alle', v: -1 }].concat(LIFTS.map((l, i) => ({ label: l.short, v: i })));
    const body = [];
    if (view === -1) {
      body.push(h('div', { class: 'matrix-head' }, h('span'), LIFTS.map((l) => h('span', null, l.short, h('br'), fmt(orm(l.id, c)) + ' kg'))));
      [0, 1, 2, 3, 4].forEach((w) => body.push(h('div', { class: 'matrix-row' + (w === nowW ? ' now' : '') },
        h('span', { class: 'wl', text: w === 4 ? 'Deload' : 'W' + (w + 1) }),
        LIFTS.map((l) => { const t = target(l.id, c, w); const st = entry(c, w, l.id).s;
          return h('button', { class: 'cell' + (st ? ' is-' + st : ''), type: 'button', 'aria-label': l.name + ', ' + weekShort(w) + ': ' + fmt(t.kg) + ' kg, ' + t.scheme + (st === 'ok' ? ', geschafft' : st === 'miss' ? ', nicht geschafft' : ''),
            onclick: () => openSub('lift', { lift: { id: l.id, c, w, from: 'plan' } }) }, h('span', { class: 'num', text: fmt(t.kg) }), h('span', { class: 'tiny', text: t.scheme })); }))));
    } else {
      const l = LIFTS[view];
      const skipped = c > 1 && S.skips[l.id].includes(c);
      body.push(h('div', { class: 'card row between' },
        h('div', { class: 'col', style: { gap: '2px' } }, h('span', { class: 'small muted', text: l.name + ' · Maximalkraft' }), h('span', { class: 'num', style: { fontSize: '34px' }, text: fmt(orm(l.id, c)) + ' kg' })),
        h('span', { class: 'tiny', style: { textAlign: 'right', color: skipped ? 'var(--warn)' : 'var(--muted)' } }, skipped ? 'Steigerung' : '+' + fmt(S.inc[l.id]) + ' kg', h('br'), skipped ? 'ausgesetzt' : 'pro Zyklus')));
      [0, 1, 2, 3, 4].forEach((w) => { const t = target(l.id, c, w); const st = entry(c, w, l.id).s; body.push(h('button', { class: 'wk-row' + (w === nowW ? ' now' : '') + (st ? ' is-' + st : ''), type: 'button',
        onclick: () => openSub('lift', { lift: { id: l.id, c, w, from: 'plan' } }) },
        h('strong', { text: weekShort(w) }), h('span', { class: 'muted', text: t.pct + ' %' }), h('span', { text: t.scheme }), h('span', { class: 'num', text: fmt(t.kg) + ' kg' }))); });
    }
    return h('main', { class: 'screen' },
      h('div', { class: 'row between' }, h('h1', { text: 'Plan' }),
        h('button', { class: 'icon-btn' + (V.update === 'available' ? ' has-dot' : ''), type: 'button', 'aria-label': V.update === 'available' ? 'Einstellungen, Update verfügbar' : 'Einstellungen', onclick: () => openSub('settings') }, icon('gear'))),
      h('div', { class: 'card row', style: { padding: '4px' } },
        h('button', { class: 'icon-btn flat', type: 'button', 'aria-label': 'Vorheriger Zyklus', disabled: c <= 1, onclick: () => { V.planC = c - 1; render(); } }, icon('chevL')),
        h('div', { class: 'grow col center', style: { gap: '0' } }, h('span', { class: 'num', style: { fontSize: '24px' }, text: 'Zyklus ' + c }),
          h('span', { class: 'tiny muted', text: c === S.pos.c ? 'aktuell' : c < S.pos.c ? 'abgeschlossen' : c === CYCLES ? 'danach neu testen' : 'Vorschau' })),
        h('button', { class: 'icon-btn flat', type: 'button', 'aria-label': 'Nächster Zyklus', disabled: c >= CYCLES, onclick: () => { V.planC = c + 1; render(); } }, icon('chevR'))),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Ansicht' }, tabs.map((t) => h('button', { type: 'button', 'aria-pressed': String(view === t.v), text: t.label, onclick: () => { V.planView = t.v; render(); } }))),
      h('div', { class: 'col', style: { gap: '6px' } }, body),
      h('p', { class: 'tiny muted', text: 'Gewichte auf 2,5 kg gerundet. Aktuelle Woche umrandet, grün/rot = geschafft/nicht geschafft. Antippen öffnet die Übung.' }));
  }

  // ---------- Kraftwerte ----------
  function renderKraft() {
    const r = cur();
    const c = S.pos.c;
    const n = LIFTS.filter((l) => hasTest(l.id)).length;
    return h('main', { class: 'screen' },
      h('div', { class: 'col' }, h('h1', { text: 'Kraftwerte' }),
        h('span', { class: 'small muted', text: 'Runde ' + r.n + ' · ' + (n === 4 ? 'alle Werte eingetragen' : n + ' von 4 eingetragen') + (n ? ' · Werte für Zyklus ' + c : '') })),
      n < 4 ? h('div', { class: 'banner' }, h('span', { class: 'accent' }, icon('alert')),
        h('p', null, h('strong', { text: 'Am genauesten bei ' + REP_MIN + '–' + REP_MAX + ' Wiederholungen. ' }), 'Teste jede Übung, wann es passt, und trag sie einzeln ein.')) : null,
      LIFTS.map((l) => {
        const t = r.test[l.id];
        return h('div', { class: 'test-card' },
          h('div', { class: 'row between' }, h('strong', { text: l.name }),
            h('span', { class: 'orm' + (t ? '' : ' empty'), text: fmt(orm(l.id, c)) + ' kg' })),
          h('div', { class: 'row between', style: { gap: '8px' } },
            h('span', { class: 'col', style: { gap: '0', alignItems: 'flex-start' } },
              t ? h('span', { class: 'tiny muted', text: 'Test: ' + fmt(t.kg) + ' kg × ' + t.reps + (t.date ? ' · ' + new Date(t.date).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' }) : '') }) : null,
              h('button', { class: 'link', type: 'button', style: { paddingLeft: '0', fontSize: '14px', minHeight: t ? '36px' : '44px' }, text: t ? 'Testwert ändern' : '+ Testwert eintragen', onclick: () => testSheet(l.id) })),
            h('div', { class: 'seg dark', style: { minWidth: '104px', flex: 'none' }, role: 'group', 'aria-label': l.name + ': Steigerung pro Zyklus' }, [2.5, 5].map((v) =>
              h('button', { type: 'button', 'aria-pressed': String(S.inc[l.id] === v), text: '+' + fmt(v), onclick: () => { S.inc[l.id] = v; save(); render(); } })))));
      }),
      h('button', { class: 'btn ' + (S.roundDone ? 'primary' : 'ghost') + ' block', type: 'button', onclick: startNewRound }, 'Neue Runde starten'),
      h('p', { class: 'tiny muted', text: 'Steigerung = kg pro Zyklus. Formel wie in deiner Tabelle: 1RM = Gewicht + Gewicht × Wdh. × 0,033, gerundet auf 2,5 kg.' }));
  }

  // ---------- Körpergewicht ----------
  const isoDay = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const dayTime = (d) => new Date(d + 'T12:00:00').getTime();
  const dayDE = (d) => { const t = dayTime(d); return d === isoDay(Date.now()) ? 'heute' : d === isoDay(Date.now() - DAY) ? 'gestern' : new Date(t).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' }); };
  const latestBody = () => (S.body.length ? S.body[S.body.length - 1] : null);
  function bodyAt(daysBack) {
    const lim = isoDay(Date.now() - daysBack * DAY);
    for (let i = S.body.length - 1; i >= 0; i--) if (S.body[i].d <= lim) return S.body[i];
    return null;
  }
  function bodySheet() {
    const last = latestBody();
    sheet('Körpergewicht eintragen', (close) => {
      const kgIn = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Körpergewicht in kg', placeholder: last ? fmt(last.kg) : '0', style: { width: '96px' } });
      const dIn = h('input', { type: 'date', class: 'date', 'aria-label': 'Datum', value: isoDay(Date.now()), max: isoDay(Date.now()) });
      const err = h('p', { class: 'hint-warn', hidden: true });
      const saveBtn = h('button', { class: 'btn primary', type: 'button', text: 'Speichern', disabled: true });
      const ok = () => { const v = parseNum(kgIn.value); return v >= 30 && v <= 300 && /^\d{4}-\d{2}-\d{2}$/.test(dIn.value) && dIn.value <= isoDay(Date.now()); };
      const upd = () => { saveBtn.disabled = !ok(); };
      kgIn.addEventListener('input', upd); dIn.addEventListener('input', upd); dIn.addEventListener('change', upd);
      saveBtn.addEventListener('click', () => {
        if (!ok()) { err.textContent = 'Bitte ein Gewicht zwischen 30 und 300 kg und ein Datum bis heute eingeben.'; err.hidden = false; return; }
        const undo = snapshot();
        const kg = Math.round(parseNum(kgIn.value) * 10) / 10;
        S.body = S.body.filter((b) => b.d !== dIn.value).concat([{ d: dIn.value, kg }]).sort((x, y) => (x.d < y.d ? -1 : 1));
        save(); close(); render(); toast(fmt(kg) + ' kg eingetragen', undo);
      });
      return h('div', { class: 'stack' },
        h('p', { class: 'muted small', text: 'Am aussagekräftigsten: einmal pro Woche, morgens nüchtern, gleiche Waage.' }),
        h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap' } },
          h('label', { class: 'field' }, kgIn, 'kg'),
          h('label', { class: 'field grow', style: { justifyContent: 'flex-end' } }, 'am', dIn)),
        err,
        h('div', { class: 'btns' }, h('button', { class: 'btn ghost', type: 'button', text: 'Abbrechen', onclick: close }), saveBtn));
    });
  }
  function deltaChip(label, now, then) {
    if (!then) return null;
    const d = Math.round((now.kg - then.kg) * 10) / 10;
    return h('span', { class: 'col', style: { gap: '0' } }, h('span', { class: 'tiny muted', text: label }),
      h('span', { class: 'num', style: { fontSize: '18px', color: d > 0 ? 'var(--text)' : d < 0 ? 'var(--text)' : 'var(--muted)' }, text: (d > 0 ? '+' : d < 0 ? '−' : '±') + fmt(Math.abs(d)) + ' kg' }));
  }
  function bodyChart() {
    const pts = S.body.filter((b) => dayTime(b.d) >= Date.now() - 182 * DAY);
    if (!pts.length) return null;
    const W = 320, H = 110, L = 32, R = 312, T = 10, B = 88;
    const vs = pts.map((p) => p.kg);
    let lo = Math.floor(Math.min(...vs) - 1), hi = Math.ceil(Math.max(...vs) + 1);
    if (hi - lo < 4) { const m = (hi + lo) / 2; lo = Math.floor(m - 2); hi = Math.ceil(m + 2); }
    const t0 = dayTime(pts[0].d), t1 = dayTime(pts[pts.length - 1].d);
    const x = (d) => (t1 === t0 ? (L + R) / 2 : L + (dayTime(d) - t0) / (t1 - t0) * (R - L));
    const y = (v) => B - (v - lo) / (hi - lo) * (B - T);
    const short = (d) => new Date(dayTime(d)).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' });
    return h('svg:svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Körpergewicht von ' + fmt(pts[0].kg) + ' auf ' + fmt(pts[pts.length - 1].kg) + ' kg' },
      [lo, hi].map((v) => [h('svg:line', { x1: L, x2: R, y1: y(v), y2: y(v), stroke: '#2A2E33' }), h('svg:text', { x: 0, y: y(v) + 4, fill: '#A3A9AF', 'font-size': '10' }, String(v))]),
      pts.length > 1 ? h('svg:polyline', { points: pts.map((p) => x(p.d).toFixed(1) + ',' + y(p.kg).toFixed(1)).join(' '), fill: 'none', stroke: '#ECEDEE', 'stroke-width': '2.5', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }) : null,
      pts.map((p, i) => h('svg:circle', { cx: x(p.d), cy: y(p.kg), r: i === pts.length - 1 ? '4.5' : '2.5', fill: i === pts.length - 1 ? '#1C1F23' : '#ECEDEE', stroke: '#ECEDEE', 'stroke-width': '2' })),
      h('svg:text', { x: L, y: H - 4, fill: '#A3A9AF', 'font-size': '10' }, short(pts[0].d)),
      pts.length > 1 ? h('svg:text', { x: R, y: H - 4, fill: '#A3A9AF', 'font-size': '10', 'text-anchor': 'end' }, short(pts[pts.length - 1].d)) : null);
  }
  function renderBodyCard() {
    const last = latestBody();
    const head = h('div', { class: 'row between' }, h('strong', { text: 'Körpergewicht' }),
      h('button', { class: 'btn primary small', type: 'button', style: { minHeight: '36px', padding: '0 12px' }, onclick: bodySheet }, '+ Eintragen'));
    if (!last) return h('section', { class: 'card col', style: { gap: '10px' }, 'aria-label': 'Körpergewicht' }, head,
      h('p', { class: 'small muted', text: 'Trag dein Gewicht z. B. einmal pro Woche ein. Dann siehst du hier deinen Verlauf und bei jeder Übung deine relative Kraft (Maximalkraft geteilt durch Körpergewicht).' }));
    const startD = isoDay(cur().date);
    const roundStart = S.body.find((b) => b.d >= startD) || null;
    const days = Math.round((Date.now() - dayTime(last.d)) / DAY);
    const list = S.body.slice().reverse();
    return h('section', { class: 'card col', style: { gap: '10px' }, 'aria-label': 'Körpergewicht' }, head,
      h('div', { class: 'row', style: { gap: '20px', alignItems: 'flex-end', flexWrap: 'wrap' } },
        h('span', { class: 'col', style: { gap: '0' } }, h('span', { class: 'tiny muted', text: dayDE(last.d) }),
          h('span', null, h('span', { class: 'num', style: { fontSize: '34px' }, text: fmt(last.kg) }), h('span', { class: 'small muted', text: ' kg' }))),
        deltaChip('4 Wochen', last, (() => { const b = bodyAt(28); return b && b !== last ? b : null; })()),
        deltaChip('seit Rundenstart', last, roundStart && roundStart !== last ? roundStart : null)),
      bodyChart(),
      days >= 7 ? h('p', { class: 'tiny', style: { color: 'var(--warn)' }, text: 'Letzter Eintrag vor ' + days + ' Tagen – Zeit für ein Update.' }) : null,
      h('details', { class: 'notes', style: { background: 'var(--bg)' } },
        h('summary', null, 'Alle Einträge (' + S.body.length + ')'),
        list.map((b) => h('div', { class: 'list-row', style: { minHeight: '44px', borderTop: '1px solid var(--line)', borderBottom: 'none' } },
          h('span', { class: 'grow small', text: new Date(dayTime(b.d)).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) }),
          h('strong', { class: 'small', text: fmt(b.kg) + ' kg' }),
          h('button', { class: 'icon-btn flat', type: 'button', 'aria-label': 'Eintrag vom ' + dayDE(b.d) + ' löschen', style: { width: '40px', height: '40px', color: 'var(--muted)' }, onclick: () => {
            const undo = snapshot(); S.body = S.body.filter((x) => x !== b); save(); render(); toast('Eintrag gelöscht', undo);
          } }, icon('x', 'i s'))))));
  }
  function relLine(id, ormNow) {
    const last = latestBody();
    if (!last || !ormNow) return null;
    return h('div', { class: 'row between tiny muted' }, h('span', { text: 'Relative Kraft' }),
      h('strong', { style: { color: 'var(--text)' }, text: fmt(Math.round(ormNow / last.kg * 100) / 100) + ' × Körpergewicht' }));
  }

  // ---------- Verlauf ----------
  const planVal = (id, c) => cur().test[id].orm + S.inc[id] * (c - 1);
  // Ist = Maximalkraft, mit der ein Zyklus erfolgreich trainiert wurde (mind. 3 von 4 Wochen geschafft)
  function istSeries(id) {
    const last = S.roundDone ? CYCLES : S.pos.c - 1;
    let reached = cur().test[id].orm;
    const pts = [];
    for (let k = 1; k <= last; k++) {
      const ok = [0, 1, 2, 3].filter((w) => entry(k, w, id).s === 'ok').length;
      if (ok >= 3) reached = Math.max(reached, orm(id, k));
      pts.push({ c: k, v: reached });
    }
    return { pts: pts.length ? pts : [{ c: 1, v: reached }], last, now: reached };
  }

  function liftChart(l, ist) {
    const W = 320, H = 118, L = 30, R = 312, T = 10, B = 96;
    const lo0 = Math.min(cur().test[l.id].orm, ...ist.pts.map((p) => p.v));
    const hi0 = planVal(l.id, CYCLES);
    const lo = Math.floor((lo0 - 2) / 5) * 5, hi = Math.ceil((hi0 + 2) / 5) * 5;
    const x = (c) => L + (c - 1) * (R - L) / (CYCLES - 1), y = (v) => B - (v - lo) / (hi - lo) * (B - T);
    const planPts = Array.from({ length: CYCLES }, (_, i) => x(i + 1).toFixed(1) + ',' + y(planVal(l.id, i + 1)).toFixed(1)).join(' ');
    const istPts = ist.pts.map((p) => x(p.c).toFixed(1) + ',' + y(p.v).toFixed(1)).join(' ');
    const cx = x(S.roundDone ? CYCLES : S.pos.c);
    const lastP = ist.pts[ist.pts.length - 1];
    return h('svg:svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': l.name + ': Plan von ' + fmt(planVal(l.id, 1)) + ' auf ' + fmt(hi0) + ' kg, Ist aktuell ' + fmt(ist.now) + ' kg' },
      [lo, hi].map((v) => [h('svg:line', { x1: L, x2: R, y1: y(v), y2: y(v), stroke: '#2A2E33' }),
        h('svg:text', { x: 0, y: y(v) + 4, fill: '#A3A9AF', 'font-size': '10' }, fmt(v))]),
      h('svg:line', { x1: cx, x2: cx, y1: T - 4, y2: B + 2, stroke: '#ECEDEE', 'stroke-dasharray': '2 4', opacity: '0.45' }),
      h('svg:text', { x: L, y: H - 4, fill: '#A3A9AF', 'font-size': '10' }, 'Z1'),
      h('svg:text', { x: R - 18, y: H - 4, fill: '#A3A9AF', 'font-size': '10' }, 'Z10'),
      h('svg:polyline', { points: planPts, fill: 'none', stroke: '#8A9099', 'stroke-width': '2', 'stroke-dasharray': '5 5', 'stroke-linecap': 'round' }),
      ist.pts.length > 1 ? h('svg:polyline', { points: istPts, fill: 'none', stroke: l.color, 'stroke-width': '3', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }) : null,
      ist.pts.map((p) => h('svg:circle', { cx: x(p.c), cy: y(p.v), r: p === lastP ? '5' : '3', fill: p === lastP ? '#1C1F23' : l.color, stroke: l.color, 'stroke-width': '2.5' })));
  }

  function quotaLine(id) {
    let ok = 0, tot = 0;
    for (let c = 1; c <= CYCLES; c++) for (let w = 0; w < 5; w++) {
      if (!S.roundDone && cmpPos({ c, w }, S.pos) >= 0) continue;
      tot++; if (entry(c, w, id).s === 'ok') ok++;
    }
    if (!tot) return null;
    const p = Math.round(ok / tot * 100);
    return h('div', { class: 'row between tiny muted', style: { marginTop: '2px' } },
      h('span', { text: 'Geschafft: ' + ok + ' von ' + tot + ' Wochen' }),
      h('span', { class: 'quota' }, h('span', { class: 'quota-bar' }, h('span', { style: { width: p + '%' } })), p + ' %'));
  }

  function renderVerlauf() {
    const done = S.roundDone ? 50 : (S.pos.c - 1) * 5 + S.pos.w;
    const pct = Math.round(done / 50 * 100);
    const hist = S.rounds.slice().reverse();
    return h('main', { class: 'screen' },
      h('h1', { text: 'Verlauf' }),
      h('div', { class: 'card col', style: { gap: '8px' } },
        h('div', { class: 'row between small' }, h('strong', { text: S.roundDone ? 'Runde ' + S.round + ' abgeschlossen' : 'Runde ' + S.round + ' · Zyklus ' + S.pos.c + ' · ' + weekShort(S.pos.w) }), h('span', { class: 'muted', text: done + ' / 50 Wochen' })),
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '50', 'aria-valuenow': String(done), 'aria-label': 'Fortschritt der Runde' }, h('div', { style: { width: pct + '%' } }))),
      renderBodyCard(),
      h('div', { class: 'label', text: 'Kraft pro Übung' }),
      h('div', { class: 'legend' },
        h('span', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'lg-plan' }), 'Plan'),
        h('span', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'lg-ist' }), 'Ist'),
        h('span', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'lg-now' }), 'jetzt')),
      LIFTS.map((l) => {
        if (!hasTest(l.id)) return h('section', { class: 'card row between', 'aria-label': l.name },
          h('span', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'dot', style: { background: l.color } }), h('strong', { text: l.name })),
          h('button', { class: 'link', type: 'button', style: { fontSize: '14px' }, text: '+ Testwert eintragen', onclick: () => testSheet(l.id) }));
        const ist = istSeries(l.id);
        const planNow = ist.last ? planVal(l.id, ist.last) : planVal(l.id, 1);
        const diff = ist.now - planNow;
        const chip = !ist.last ? h('span', { class: 'badge', text: 'Start' })
          : diff >= 0 ? h('span', { class: 'badge ok' }, icon('check', 'i s'), 'im Plan')
            : h('span', { class: 'badge miss', text: fmt(diff) + ' kg' });
        return h('section', { class: 'card col', style: { gap: '6px' }, 'aria-label': l.name },
          h('div', { class: 'row between' }, h('span', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'dot', style: { background: l.color } }), h('strong', { text: l.name })), chip),
          h('div', { class: 'row', style: { gap: '16px', alignItems: 'baseline' } },
            h('span', null, h('span', { class: 'tiny muted', text: 'Ist ' }), h('span', { class: 'num', style: { fontSize: '26px', color: l.color }, text: fmt(ist.now) }), h('span', { class: 'tiny muted', text: ' kg' })),
            h('span', null, h('span', { class: 'tiny muted', text: 'Plan ' }), h('span', { class: 'num', style: { fontSize: '20px' }, text: fmt(planNow) }), h('span', { class: 'tiny muted', text: ' kg' })),
            h('span', { class: 'grow', style: { textAlign: 'right' } }, h('span', { class: 'tiny muted', text: 'Ziel Z10 ' }), h('span', { class: 'num', style: { fontSize: '20px' }, text: fmt(planVal(l.id, CYCLES)) }))),
          liftChart(l, ist), quotaLine(l.id), relLine(l.id, ist.now));
      }),
      h('p', { class: 'tiny muted', text: 'Ist = Maximalkraft, mit der du einen Zyklus erfolgreich trainiert hast (mind. 3 von 4 Wochen geschafft). Startwert ist dein Test. Plan = Test + Steigerung pro Zyklus.' }),
      h('div', { class: 'label', text: 'Deine Tests' }),
      h('div', { class: 'card tight' }, hist.map((r, i) => {
        const prevR = hist[i + 1];
        return h('div', { class: 'list-row', style: { flexDirection: 'column', alignItems: 'stretch', gap: '6px', padding: '12px 0' } },
          h('div', { class: 'row between small' }, h('strong', { text: 'Runde ' + r.n }), h('span', { class: 'muted', text: dateDE(r.date) })),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '4px' } }, LIFTS.map((l) => {
            const v = r.test[l.id];
            const d = prevR && v && prevR.test[l.id] ? v.orm - prevR.test[l.id].orm : null;
            return h('div', { class: 'col center', style: { gap: '0' } }, h('span', { class: 'tiny muted', text: l.short }), h('span', { class: 'num', style: { fontSize: '20px', color: v ? 'var(--text)' : 'var(--dim)' }, text: v ? fmt(v.orm) : '0' }),
              d != null ? h('span', { class: 'tiny', style: { color: d >= 0 ? 'var(--good)' : 'var(--bad)' }, text: (d >= 0 ? '+' : '') + fmt(d) }) : null);
          })));
      })));
  }

  // ---------- Einstellungen ----------
  function renderUpdateCard() {
    const controlled = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
    const info = updInfo();
    const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'gerade eben' : m < 60 ? 'vor ' + m + ' Min.' : m < 1440 ? 'vor ' + Math.round(m / 60) + ' Std.' : 'am ' + dateDE(t); };
    const st = V.update;
    const status = {
      idle: [info.checked ? 'Zuletzt geprüft ' + ago(info.checked) : 'Noch nicht geprüft', 'muted'],
      checking: ['Vergleiche App-Dateien mit dem Server …', 'muted'],
      latest: ['Du hast die neueste Version.', 'good'],
      available: ['Update verfügbar' + (V.changed && V.changed.length ? ': ' + V.changed.join(', ') : ''), 'accent'],
      installing: ['Wird installiert – die App startet gleich neu …', 'muted'],
      offline: ['Keine Internetverbindung. Updates gehen nur online.', 'warn'],
      nocache: ['Offline-Speicher ist noch nicht eingerichtet. Schließe die App einmal komplett und öffne sie neu – oder lade die App-Dateien unten neu.', 'warn'],
      error: ['Prüfung fehlgeschlagen' + (V.updError ? ' (' + V.updError + ')' : '') + '. Versuch es später nochmal oder lade die App-Dateien neu.', 'warn']
    }[st] || ['', 'muted'];
    const color = { muted: 'var(--muted)', good: 'var(--good)', accent: 'var(--accent)', warn: 'var(--warn)' }[status[1]];
    const busy = st === 'checking' || st === 'installing';
    return h('div', { class: 'card col', style: { gap: '12px' } },
      h('div', { class: 'row between' },
        h('span', { class: 'col', style: { gap: '2px' } }, h('strong', { text: 'Version ' + APP_VERSION }),
          h('span', { class: 'tiny muted', text: (info.updated ? 'Aktualisiert ' + ago(info.updated) + ' · ' : '') + (controlled ? 'offline verfügbar' : 'offline nach Neustart') })),
        controlled ? h('span', { class: 'badge ok' }, icon('check', 'i s'), 'Offline') : null),
      h('p', { class: 'small', style: { color }, role: 'status', text: status[0] }),
      st === 'available'
        ? h('button', { class: 'btn primary block', type: 'button', onclick: applyUpdate }, icon('refresh', 'i s'), 'Update installieren')
        : h('button', { class: 'btn ghost block', type: 'button', disabled: busy, onclick: () => checkUpdate(false) }, icon('refresh', 'i s'), busy ? (st === 'checking' ? 'Wird geprüft …' : 'Wird installiert …') : 'Nach Updates suchen'),
      h('button', { class: 'link', type: 'button', style: { alignSelf: 'center', fontSize: '13px', color: 'var(--muted)' }, disabled: busy, onclick: repairApp }, 'Probleme? App-Dateien neu laden'));
  }

  function renderSettings() {
    return h('main', { class: 'screen' },
      h('button', { class: 'link', type: 'button', style: { alignSelf: 'flex-start' }, onclick: closeSub }, icon('chevL', 'i s'), 'Plan'),
      h('h1', { text: 'Einstellungen' }),
      h('div', { class: 'label', text: 'Daten' }),
      h('div', { class: 'card tight' },
        h('button', { class: 'list-row', type: 'button', onclick: startBackup }, h('span', { class: 'accent' }, icon('down')), h('span', { class: 'grow', text: 'Backup erstellen' }), h('span', { class: 'tiny muted', text: 'verschlüsselt' })),
        h('button', { class: 'list-row', type: 'button', onclick: startImport }, h('span', { class: 'accent' }, icon('up')), h('span', { class: 'grow', text: 'Backup importieren' }), icon('chevR', 'i s'))),
      h('p', { class: 'tiny muted', style: { padding: '0 4px' }, text: 'Letztes Backup: ' + (S.lastBackup ? dateDE(S.lastBackup) + ' (vor ' + daysAgo(S.lastBackup) + ' Tagen)' : 'noch keins') + ' · Daten liegen nur auf diesem Gerät.' }),
      h('div', { class: 'label', text: 'App' }),
      renderUpdateCard(),
      h('div', { class: 'label', text: 'Gefahrenzone' }),
      h('div', { class: 'card tight' }, h('button', { class: 'btn danger block', type: 'button', text: 'Alle Daten löschen', onclick: async () => {
        if (!(await confirmSheet('Alle Daten löschen?', 'Testwerte, Plan-Fortschritt und Notizen werden von diesem Gerät gelöscht. Das lässt sich nur mit einem Backup rückgängig machen.', 'Endgültig löschen', true))) return;
        localStorage.removeItem(STORE_KEY); S = blank(); V.sub = null; V.tab = 'woche'; V.wk = null; render(true); toast('Alle Daten gelöscht');
      } })),
      h('p', { class: 'tiny muted', style: { textAlign: 'center', marginTop: '8px' }, text: 'Kraftzyklus ' + APP_VERSION + ' · keine Cloud, kein Konto, kein Tracking' }));
  }

  // ---------- Backup (AES-GCM 256, Schlüssel per PBKDF2-SHA-256) ----------
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (buf) => { let s = ''; new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
  const ITER = 600000;
  async function deriveKey(pw, salt, iter) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptState(pw) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pw, salt, ITER);
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(S)));
    return JSON.stringify({ format: 'kraftzyklus-backup', v: 1, created: new Date().toISOString(), app: APP_VERSION,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITER, salt: b64(salt) }, cipher: { name: 'AES-GCM', iv: b64(iv) }, data: b64(data) });
  }
  async function decryptBackup(file, pw) {
    const key = await deriveKey(pw, unb64(file.kdf.salt), file.kdf.iterations);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(file.cipher.iv) }, key, unb64(file.data));
    return JSON.parse(dec.decode(plain));
  }

  function startBackup() {
    sheet('Backup verschlüsseln', (close) => {
      const p1 = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': 'Passwort' });
      const p2 = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': 'Passwort wiederholen' });
      const err = h('p', { class: 'hint-warn', hidden: true });
      const go = h('button', { class: 'btn primary', type: 'button', text: 'Verschlüsseln' });
      const info = h('p', { class: 'muted small', text: 'Ohne dieses Passwort lässt sich das Backup nicht öffnen. Es wird nirgends gespeichert – bitte gut merken.' });
      let ready = null;
      const name = 'kraftzyklus-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      go.addEventListener('click', async () => {
        err.hidden = true;
        if (ready) {
          // Eigener Tipp zum Speichern, damit iOS das Teilen-Menü zuverlässig öffnet
          try {
            if (await saveFile(ready, name)) { S.lastBackup = Date.now(); S.backupSnooze = 0; save(); close(); render(); toast('Backup gespeichert'); }
          } catch (e) { err.textContent = 'Speichern fehlgeschlagen. Bitte erneut versuchen.'; err.hidden = false; }
          return;
        }
        if (p1.value.length < 6) { err.textContent = 'Mindestens 6 Zeichen.'; err.hidden = false; return; }
        if (p1.value !== p2.value) { err.textContent = 'Die Passwörter stimmen nicht überein.'; err.hidden = false; return; }
        go.disabled = true; go.textContent = 'Verschlüssele …';
        try {
          ready = await encryptState(p1.value);
          p1.value = ''; p2.value = ''; p1.disabled = true; p2.disabled = true;
          info.textContent = 'Backup ist verschlüsselt. Tippe auf „Datei sichern“ und wähle z. B. „In Dateien sichern“.';
          go.textContent = 'Datei sichern';
        } catch (e) { err.textContent = 'Verschlüsseln fehlgeschlagen. Bitte erneut versuchen.'; err.hidden = false; go.textContent = 'Verschlüsseln'; }
        go.disabled = false;
      });
      return h('div', { class: 'stack' },
        info,
        h('label', { class: 'col tiny muted' }, 'Passwort', p1),
        h('label', { class: 'col tiny muted' }, 'Passwort wiederholen', p2),
        err,
        h('div', { class: 'btns' }, h('button', { class: 'btn ghost', type: 'button', text: 'Abbrechen', onclick: close }), go));
    });
  }
  async function saveFile(text, name) {
    const file = new File([text], name, { type: 'application/json' });
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Kraftzyklus-Backup' }); return true; }
      catch (e) { if (e && e.name === 'AbortError') return false; }
    }
    const url = URL.createObjectURL(file);
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  }

  function startImport() {
    const input = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      input.remove();
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { toast('Datei zu groß für ein Backup'); return; }
      let file;
      try { file = JSON.parse(await f.text()); } catch (e) { toast('Keine gültige Backup-Datei'); return; }
      if (!file || file.format !== 'kraftzyklus-backup' || !file.kdf || !file.cipher || !file.data) { toast('Keine Kraftzyklus-Backup-Datei'); return; }
      sheet('Backup öffnen', (close) => {
        const pw = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Backup-Passwort' });
        const err = h('p', { class: 'hint-warn', hidden: true });
        const go = h('button', { class: 'btn primary', type: 'button', text: 'Öffnen' });
        go.addEventListener('click', async () => {
          err.hidden = true; go.disabled = true; go.textContent = 'Entschlüssele …';
          let data;
          try { data = await decryptBackup(file, pw.value); }
          catch (e) { err.textContent = 'Passwort falsch oder Datei beschädigt.'; err.hidden = false; go.disabled = false; go.textContent = 'Öffnen'; return; }
          if (!valid(data)) { err.textContent = 'Das Backup enthält keine gültigen Daten.'; err.hidden = false; go.disabled = false; go.textContent = 'Öffnen'; return; }
          close();
          if ((LIFTS.some((l) => hasTest(l.id)) || Object.keys(S.log).length) && !(await confirmSheet('Backup einspielen?', 'Backup vom ' + dateDE(file.created) + '. Deine aktuellen Daten auf diesem Gerät werden ersetzt.', 'Einspielen'))) return;
          S = migrate(data); S.lastActive = Date.now(); save(); requestPersist();
          V.sub = null; V.tab = 'woche'; V.wk = null; V.planC = null; render(true); toast('Backup eingespielt');
        });
        return h('div', { class: 'stack' },
          h('p', { class: 'muted small', text: 'Backup vom ' + dateDE(file.created) + '. Gib das Passwort ein, mit dem du es erstellt hast.' }),
          h('label', { class: 'col tiny muted' }, 'Passwort', pw), err,
          h('div', { class: 'btns' }, h('button', { class: 'btn ghost', type: 'button', text: 'Abbrechen', onclick: close }), go));
      });
    });
    document.body.append(input);
    input.click();
  }

  // ---------- Offline & Updates ----------
  // Prinzip: Die App vergleicht ihre gespeicherten Dateien Byte für Byte mit dem Server.
  // Damit wird jede Änderung erkannt – auch wenn eine Versionsnummer vergessen wurde.
  const CHECK = '_kzcheck';
  const UPD_KEY = 'kraftzyklus.update';
  const CORE = ['./', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest',
    'fonts/barlow-condensed-latin-600-normal.woff2', 'fonts/barlow-condensed-latin-700-normal.woff2',
    'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];
  let swReg = null, reloading = false, pending = [];
  const updInfo = () => { try { return JSON.parse(localStorage.getItem(UPD_KEY)) || {}; } catch (e) { return {}; } };
  const setUpdInfo = (p) => { try { localStorage.setItem(UPD_KEY, JSON.stringify(Object.assign(updInfo(), p))); } catch (e) { /* egal */ } };
  function requestPersist() { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* optional */ } }

  function freshFetch(path) {
    const u = new URL(path, location.href);
    u.searchParams.set(CHECK, Date.now().toString(36));
    return fetch(u.href, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(path + ': ' + r.status); return r; });
  }
  async function appCache() {
    if (!('caches' in window)) return null;
    const names = (await caches.keys()).filter((n) => n.startsWith('kraftzyklus-'));
    return names.length ? caches.open(names[names.length - 1]) : null;
  }
  function sameBytes(a, b) {
    if (a.byteLength !== b.byteLength) return false;
    const x = new Uint8Array(a), y = new Uint8Array(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }
  // Liefert die geänderten Dateien (mit frischer Antwort) oder wirft bei Netzfehler
  async function diffFiles(cache, only) {
    const reqs = await cache.keys();
    const list = only ? reqs.filter((r) => only.some((p) => new URL(r.url).pathname.endsWith(p))) : reqs;
    const res = await Promise.all(list.map(async (req) => {
      const [net, old] = await Promise.all([freshFetch(req.url), cache.match(req)]);
      const a = await net.clone().arrayBuffer();
      const b = old ? await old.arrayBuffer() : null;
      return b && sameBytes(a, b) ? null : { req, net, name: new URL(req.url).pathname.split('/').pop() || 'index.html' };
    }));
    return res.filter(Boolean);
  }
  // Wartet kurz, bis ein neu gefundener Service Worker fertig installiert ist
  async function swUpdateWaiting() {
    if (!swReg) return false;
    try { await swReg.update(); } catch (e) { return !!swReg.waiting; }
    const t0 = Date.now();
    while (swReg.installing && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 150));
    return !!swReg.waiting;
  }

  async function checkUpdate(silent) {
    if (V.update === 'checking' || V.update === 'installing') return;
    if (!navigator.onLine) { if (!silent) { V.update = 'offline'; render(); } return; }
    const before = V.update;
    if (!silent) { V.update = 'checking'; render(); }
    try {
      const cache = await appCache();
      if (!cache) { V.update = silent ? before : 'nocache'; if (!silent) render(); return; }
      const changed = await diffFiles(cache, silent ? ['/', 'index.html', 'app.js', 'app.css'] : null);
      const swNew = await swUpdateWaiting();
      setUpdInfo({ checked: Date.now() });
      if (changed.length || swNew) {
        pending = changed;
        V.update = 'available';
        V.changed = changed.map((c) => c.name).filter((n, i, a) => a.indexOf(n) === i);
        if (silent) toast('Update verfügbar – Plan › Zahnrad');
      } else if (!silent) { V.update = 'latest'; }
    } catch (e) {
      if (!silent) { V.update = 'error'; V.updError = String(e && e.message || e); }
    }
    render();
  }

  async function applyUpdate() {
    V.update = 'installing'; render();
    try {
      // Vor dem Übernehmen noch einmal alle Dateien vergleichen (die leise Prüfung schaut nur auf die Kerndateien)
      if (navigator.onLine) { try { const c = await appCache(); if (c) pending = await diffFiles(c); } catch (e) { /* vorhandene Liste nutzen */ } }
      if (pending.length) {
        const cache = await appCache();
        // Alle neuen Dateien sind schon geladen – jetzt in einem Schritt übernehmen
        await Promise.all(pending.map((p) => cache.put(p.req, p.net)));
      }
      setUpdInfo({ updated: Date.now() });
      pending = [];
      if (swReg && swReg.waiting) {
        reloading = true;
        swReg.waiting.postMessage('SKIP_WAITING');
        setTimeout(() => location.reload(), 2500);    // Fallback, falls iOS kein controllerchange meldet
      } else location.reload();
    } catch (e) {
      V.update = 'error'; V.updError = 'Installation fehlgeschlagen'; render();
    }
  }

  // Notausgang: App-Dateien komplett neu laden. Deine Trainingsdaten bleiben unberührt.
  async function repairApp() {
    if (!(await confirmSheet('App-Dateien neu laden?', 'Alle App-Dateien werden frisch vom Server geladen. Deine Trainingsdaten, Notizen und Einstellungen bleiben erhalten. Dafür brauchst du Internet.', 'Neu laden'))) return;
    if (!navigator.onLine) { toast('Keine Verbindung – bitte online gehen'); return; }
    V.update = 'installing'; render();
    try {
      const fresh = await Promise.all(CORE.map((f) => freshFetch(f).then((r) => [new URL(f, location.href).href, r])));
      const names = (await caches.keys()).filter((n) => n.startsWith('kraftzyklus-'));
      await Promise.all(names.map((n) => caches.delete(n)));
      const cache = await caches.open('kraftzyklus-repair-' + Date.now());
      await Promise.all(fresh.map(([u, r]) => cache.put(u, r)));
      await Promise.all(CORE.map((f) => fetch(f, { cache: 'reload' }).catch(() => null)));   // auch den Browser-Cache auffrischen
      const regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : [];
      await Promise.all(regs.map((r) => r.unregister()));
      setUpdInfo({ updated: Date.now() });
      location.reload();
    } catch (e) {
      V.update = 'error'; V.updError = 'Server nicht erreichbar'; render();
      toast('Neu laden fehlgeschlagen – bitte später erneut versuchen');
    }
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      swReg = reg;
      if (reg.waiting && navigator.serviceWorker.controller) { V.update = 'available'; render(); }
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (nw) nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller && V.update !== 'installing') { V.update = 'available'; render(); }
        });
      });
    }).catch(() => { /* z. B. lokal per file:// */ });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) location.reload(); });
  }
  // Leise prüfen: beim Start und beim Zurückkehren in die App, höchstens alle 6 Stunden
  function autoCheck() {
    const last = updInfo().checked || 0;
    if (Date.now() - last > 6 * 3600000 && V.update !== 'available') checkUpdate(true);
  }
  setTimeout(autoCheck, 4000);

  // Bei Rückkehr in die App ggf. neu zeichnen (z. B. Backup-Erinnerung)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    setWake(V.sub === 'lift');
    autoCheck();
    if (!document.querySelector('.overlay') && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'INPUT') render();
  });

  render();
})();
