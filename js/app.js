/* GrowDex - app logic
   Needs: js/data.js (GS_DATA), js/i18n.js (GS_I18N), js/seeds.js (GS_SEED). Optional: js/items.js (GS_ITEMS). */
(function () {
  'use strict';

  /* ================================================================ Data */
  const D = window.GS_DATA, I18N = window.GS_I18N, seed = window.GS_SEED, ITEMS = window.GS_ITEMS || { obtain: {}, desc: {} };
  const N = D.names, nm = i => (i >= 0 ? N[i] : ''), IX = new Map(N.map((n, i) => [n, i]));
  const key = (a, b) => [a, b].sort().join('\u0001');
  const CRY = { 'Red Crystal': 'R', 'Green Crystal': 'G', 'Blue Crystal': 'B', 'White Crystal': 'W', 'Black Crystal': 'K' };

  // Splicing keeps its own pair index (two slots, swap, tiers)
  const SP = D.splice.map(([o, a, b, t, ra, ev, ch, nr]) => ({ r: nm(o), a: nm(a), b: nm(b), t, ra, ev, ch: !!ch, nr: nm(nr) }));
  const byRes = new Map(), byPair = new Map(), spUses = new Map(), chanceByPair = new Map(), pairAll = new Map();
  for (const x of SP) {
    if (x.ch) { const k = key(x.a, x.b); if (!chanceByPair.has(k)) chanceByPair.set(k, []); chanceByPair.get(k).push(x); continue; }
    if (!byRes.has(x.r)) byRes.set(x.r, x);
    const k = key(x.a, x.b); if (!byPair.has(k)) byPair.set(k, x);
    if (!pairAll.has(k)) pairAll.set(k, []); pairAll.get(k).push(x.r);   // some pairs give one of several items at random
    for (const s of new Set([x.a, x.b])) { if (!spUses.has(s)) spUses.set(s, []); spUses.get(s).push(x); }
  }
  for (const l of spUses.values()) l.sort((a, b) => a.r.localeCompare(b.r));
  const spIngredients = [...spUses.keys()].sort((a, b) => a.localeCompare(b));
  const spResults = SP.filter(x => !x.ch).sort((a, b) => a.r.localeCompare(b.r));
  const spTiers = [...new Set(spResults.map(x => x.t))].sort((a, b) => a - b);

  // Every system as a list of { out, ins: [{n, q, tag}], meta }
  const SYS = ['splice', 'combine', 'cook', 'grind', 'crystal', 'sew', 'forge', 'dna', 'fruit', 'other', 'items'];
  const R = {
    splice: SP.map(x => ({ out: x.r, ins: [{ n: x.a, q: 1 }, { n: x.b, q: 1 }], m: x })),
    combine: D.combine.map(([o, ins, y, ch, mac, c]) => ({ out: nm(o), ins: ins.map(([i, q]) => ({ n: nm(i), q })), y, ch, mac, cat: D.cats[c] })),
    cook: D.cook.map(([o, st, punch, ql, sh]) => ({ out: nm(o), ins: st.map(([i, q, t, op]) => ({ n: nm(i), q, tag: t, opt: op })), punch, ql, sh: nm(sh) })),
    grind: D.grind.map(([o, alts, ch]) => ({ out: nm(o), ins: alts.map(([i, q]) => ({ n: nm(i), q })), ch, alt: true })),
    crystal: D.crystal.map(([o, ins, y]) => {
      const c = {}; ins.forEach(i => { c[nm(i)] = (c[nm(i)] || 0) + 1; });
      return { out: nm(o), ins: Object.entries(c).map(([n, q]) => ({ n, q })), y, code: ins.map(i => CRY[nm(i)] || '?').join('') };
    }),
    sew: D.sew.map(([o, b1, s1, b2, s2, b3, y]) => ({ out: nm(o), ins: [{ n: nm(b1), q: 1, tag: 'start' }, { n: nm(b2), q: 1, tag: s1 }, { n: nm(b3), q: 1, tag: s2 }], y })),
    forge: D.forge.map(([o, i, q]) => ({ out: nm(o), ins: [{ n: nm(i), q }] })),
    dna: D.dna.map(([o, ins, y]) => ({ out: nm(o), ins: ins.map(i => ({ n: nm(i), q: 1 })), y })),
    fruit: D.fruit.map(([o, y, f]) => ({ out: nm(o), ins: f >= 0 ? [{ n: nm(f), q: 1 }] : [], y, fruit: nm(f) })),
    other: D.other.map(([o, how, x]) => ({ out: nm(o), ins: x.from && N.includes(x.from) ? [{ n: x.from, q: 1 }] : [], how, x, cat: how }))
  };
  const makers = new Map(), usedBy = new Map();
  const add = (m, k, v) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const s of SYS) for (const [i, r] of (R[s] || []).entries()) {
    if (s === 'splice' && r.m.ch) { add(makers, r.out, { s, i }); continue; }
    add(makers, r.out, { s, i });
    for (const n of new Set(r.ins.map(x => x.n))) add(usedBy, n, { s, i });
  }
  const sorted = {};
  for (const s of SYS) if (R[s]) sorted[s] = [...R[s].keys()].sort((a, b) => R[s][a].out.localeCompare(R[s][b].out));
  const allNames = [...N].sort((a, b) => a.localeCompare(b));

  /* ================================================================ Helpers */
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const match = (q, ...s) => !q || s.some(v => v && v.toLowerCase().includes(q));
  // Best matches first: exact name, then names starting with the search, then the rest
  const rank = (q, name) => { const n = name.toLowerCase(); return !q ? 0 : n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3; };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  };
  const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    chevron: svg('<path d="M6 9l6 6 6-6"/>'), check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'), cross: svg('<path d="M7 7l10 10M17 7L7 17"/>'),
    info: svg('<path d="M12 8h.01M12 11.5v5"/>'), arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    from: svg('<path d="M4 6h6l4 6-4 6H4"/><path d="M14 12h6"/>'), into: svg('<path d="M4 12h6"/><path d="M14 6h6v12h-6l-4-6z"/>'),
    sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
    moon: svg('<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>'), book: svg('<path d="M5 4h10a4 4 0 014 4v12H9a4 4 0 01-4-4z"/><path d="M5 16a4 4 0 014-4h10"/>')
  };
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ================================================================ Language and theme */
  const LANGS = Object.keys(I18N);
  let lang = store.get('gsLang');
  if (!I18N[lang]) lang = /^th/i.test(navigator.language || '') && I18N.th ? 'th' : I18N.en ? 'en' : LANGS[0];
  const nextLang = () => LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length];
  const T = k => I18N[lang][k];
  let theme = store.get('gsTheme');
  if (theme !== 'light' && theme !== 'dark') theme = null;
  const darkQuery = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  const currentTheme = () => theme || (darkQuery && darkQuery.matches ? 'dark' : 'light');
  function applyTheme() {
    if (theme) document.documentElement.dataset.theme = theme;
    const dark = currentTheme() === 'dark';
    $('themeI').innerHTML = dark ? ICON.sun : ICON.moon;
    const label = T(dark ? 'toLight' : 'toDark');
    $('theme').setAttribute('aria-label', label); $('theme').title = label;
  }
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', () => { if (!theme) applyTheme(); });

  /* ================================================================ State */
  const st = {
    sys: 'splice', view: null, item: null,
    s1: 'Purple Block', s2: 'Orange Block', r: 'Rainbow Block', act: 's2', tab: 'pick', all: false, tier: 0, subj: null,
    sel: {}, gtab: 'list', cat: {}, q: '', lim: 80, open: new Set(), anim: true
  };
  const history = [];
  const snap = () => JSON.stringify({ sys: st.sys, view: st.view, item: st.item, s1: st.s1, s2: st.s2, r: st.r, act: st.act, tab: st.tab, subj: st.subj, sel: st.sel, gtab: st.gtab });
  function remember() { const s = snap(); if (history[history.length - 1] !== s) { history.push(s); if (history.length > 80) history.shift(); } }
  const resetList = () => { st.lim = 80; st.q = ''; $('q').value = ''; st.anim = true; st.open.clear(); };
  const toTop = () => window.scrollTo({ top: 0 });
  const done = () => { resetList(); render(); toTop(); };

  function setSlot(slot, name) {
    remember();
    if (slot === 'r') { const x = byRes.get(name); if (!x) return; st.s1 = x.a; st.s2 = x.b; st.r = name; }
    else {
      st[slot] = name;
      const x = st.s1 && st.s2 ? byPair.get(key(st.s1, st.s2)) : null;
      st.r = x ? x.r : null;
      if (slot === 's1' && !st.s2) st.act = 's2'; else if (slot === 's2' && !st.s1) st.act = 's1';
    }
    st.all = false; st.view = null; done();
  }
  function openRecipe(s, i) {
    remember();
    st.view = null; st.sys = s;
    if (s === 'splice') { const r = R.splice[i]; if (r.m.ch) { st.s1 = r.m.a; st.s2 = r.m.b; st.r = byPair.get(key(r.m.a, r.m.b))?.r || null; } else { st.s1 = r.m.a; st.s2 = r.m.b; st.r = r.out; } st.tab = 'pick'; }
    else { st.sel[s] = i; st.gtab = 'list'; }
    done();
  }
  function openItem(name) { remember(); st.view = 'item'; st.item = name; done(); }
  // From a chip: follow the item inside the current system if it has a recipe there, else show its details
  function go(name) {
    if (st.sys === 'splice' && !st.view) {
      if (byRes.has(name)) return setSlot('r', name);
      remember(); st.s1 = name; st.s2 = null; st.r = null; st.act = 's2'; st.tab = 'pick'; return done();
    }
    if (st.sys !== 'items' && !st.view) { const m = (makers.get(name) || []).find(x => x.s === st.sys); if (m) return openRecipe(m.s, m.i); }
    openItem(name);
  }

  /* ================================================================ Recipe text */
  const sysName = s => T('sys')[s];
  function summary(s, r) {
    const q = x => x.q > 1 ? ` ×${x.q}` : '';
    switch (s) {
      case 'splice': return `${r.m.a} + ${r.m.b}${r.m.ch ? ' (' + T('chance') + ')' : ''}`;
      case 'grind': return r.ins.map(x => x.n + q(x)).join(` ${T('orAlt')} `);
      case 'cook': return r.ins.filter(x => !x.opt).map(x => x.n + q(x)).join(' → ');
      case 'sew': return r.ins.map(x => x.n.replace('Silk Bolt - ', '')).join(' + ');
      case 'fruit': return T('fruitHow')(r.fruit);
      case 'other': return T('otherTxt')[r.how](r.x);
      default: return r.ins.map(x => x.n + q(x)).join(' + ');
    }
  }
  function metaText(s, r) {
    const bits = [];
    if (r.y > 1) bits.push(T('yieldN')(r.y));
    if (r.ch) bits.push(T('chance'));
    if (s === 'combine') bits.push(r.mac ? T('machineIn')(r.mac) : T('anyCombiner'));
    if (s === 'cook') { if (r.punch) bits.push(T('punch') + ' ' + r.punch); if (r.ql) bits.push(T('quality')(r.ql)); if (r.sh) bits.push(T('shares')(r.sh)); }
    if (s === 'crystal') bits.push(r.code);
    if (s === 'splice') { const all = pairAll.get(key(r.m.a, r.m.b)) || []; if (all.length > 1 && !r.m.ch) bits.push(T('randomOf')(all.length)); if (r.m.ev) bits.push(T('event')[r.m.ev]); if (r.m.nr) bits.push(T('chanceSplice')(r.m.nr)); bits.push(T('tierN')(r.m.t)); }
    return bits.join(' · ');
  }

  /* ================================================================ Machine (top) */
  function slotHTML(id, name, label, sprout) {
    return `<button class="slot${id === 'r' ? ' res' : ''}" id="${id}" type="button" data-slot="${id}"><span class="lab">${esc(label)}</span><span class="box">${name ? seed(name, sprout) : '<span class="q">?</span>'}</span><span class="nm">${esc(name || T('tap'))}</span></button>`;
  }
  let prevPair = null, prevSel = null;
  function renderMachine() {
    const m = $('machine'), s = st.sys;
    const status = $('status'); status.className = 'status';
    const say = (icon, html) => { status.innerHTML = `<span class="dot">${icon}</span><span>${html}</span>`; };
    $('swap').hidden = s !== 'splice' || !!st.view;
    if (st.view === 'item' || s === 'items') {
      const n = st.view === 'item' ? st.item : null;
      m.className = 'row solo';
      m.innerHTML = n ? `<button class="slot res" type="button" data-wiki="${esc(n)}"><span class="lab">${esc(T('open'))}</span><span class="box">${seed(n, true)}</span><span class="nm">${esc(n)}</span></button>` : `<div class="hint">${ICON.book}<p>${esc(T('sysHint').items)}</p></div>`;
      const ways = n ? [...new Set([...(makers.get(n) || []).map(x => sysName(x.s)), ...(ITEMS.obtain[IX.get(n)] || []).map(x => T('obtain')[x[0]] || x[0])])] : [];
      say(ICON.info, esc(n ? (ways.length ? T('getFrom') + ': ' + ways.slice(0, 5).join(', ') : T('itemNone')) : T('sysHint').items));
      return;
    }
    if (s === 'splice') {
      m.className = 'row';
      m.innerHTML = slotHTML('s1', st.s1, T('s1')) + '<div class="op" aria-hidden="true">+</div>' + slotHTML('s2', st.s2, T('s2')) + '<div class="op" aria-hidden="true">=</div>' + slotHTML('r', st.r, T('res'), true);
      for (const id of ['s1', 's2', 'r']) $(id).classList.toggle('act', st.tab === 'pick' && st.act === id);
      const pair = st.s1 && st.s2 ? key(st.s1, st.s2) : null, x = pair ? byPair.get(pair) : null;
      if (pair && x) {
        status.classList.add('ok');
        const bonus = (chanceByPair.get(pair) || []).map(c => c.r), all = pairAll.get(pair) || [];
        const extra = [x.ra ? 'Rarity ' + x.ra : '', x.ev ? T('event')[x.ev] : '', bonus.length ? T('chance') + ': ' + bonus.join(', ') : ''].filter(Boolean).join(' · ');
        if (all.length > 1) say(ICON.check, `${esc(T('gotRandom')(all.length))} <span class="tag">T${x.t}${extra ? ' · ' + esc(extra) : ''}</span> ${esc(all.join(', '))}`);
        else say(ICON.check, `${esc(T('got'))} ${esc(x.r)} <span class="tag">T${x.t}${extra ? ' · ' + esc(extra) : ''}</span>`);
      } else if (pair) { status.classList.add('bad'); say(ICON.cross, esc(T('cant'))); }
      else if (st.s1 || st.s2) { const one = st.s1 || st.s2; say(ICON.info, esc(T('ways')(one, (spUses.get(one) || []).length))); }
      else say(ICON.info, esc(T('start')));
      m.classList.toggle('ok', !!x);
      if (pair !== prevPair && pair) effect(x ? 'pop' : 'shake');
      prevPair = pair;
      return;
    }
    const i = st.sel[s], r = i != null ? R[s][i] : null;
    m.className = 'row gen' + (r ? ' ok' : '');
    if (!r) {
      m.innerHTML = `<div class="hint">${ICON.info}<p>${esc(T('sysHint')[s])}</p></div>`;
      say(ICON.info, esc(T('pickRecipe')));
      return;
    }
    const ins = r.ins.map((x, k) => `${k && r.alt ? `<span class="or">${esc(T('orAlt'))}</span>` : ''}<button class="mini-slot" type="button" data-go="${esc(x.n)}" title="${esc(x.n)}"><span class="mbox">${seed(x.n)}${x.q > 1 ? `<b class="qty">×${x.q}</b>` : ''}</span><span class="mnm">${esc(x.n)}</span>${x.tag && x.tag !== 'start' ? `<span class="mtag">${esc(x.tag)}</span>` : ''}</button>`).join('');
    m.innerHTML = `<div class="ins">${ins || `<p class="note">${esc(summary(s, r))}</p>`}</div><div class="op arrow" aria-hidden="true">${ICON.arrow}</div>` +
      `<button class="slot res" type="button" data-item="${esc(r.out)}"><span class="lab">${esc(T('res'))}</span><span class="box">${seed(r.out, true)}${r.y > 1 ? `<b class="qty">×${r.y}</b>` : ''}</span><span class="nm">${esc(r.out)}</span></button>`;
    status.classList.add('ok');
    say(ICON.check, `${esc(T('makes')(r.out, r.y || 1))} <span class="tag">${esc(metaText(s, r))}</span>`);
    const selKey = s + i;
    if (selKey !== prevSel) effect('pop');
    prevSel = selKey;
  }
  function effect(kind) {
    const box = document.querySelector('#machine .res .box'); if (!box) return;
    box.classList.remove('pop', 'shake'); void box.offsetWidth; box.classList.add(kind);
    setTimeout(() => box.classList.remove(kind), 600);
    if (kind !== 'pop' || reduced()) return;
    const colors = ['#ffcf33', '#52b934', '#ffffff', '#ff8fb1', '#6fd3ff'];
    for (let k = 0; k < 12; k++) {
      const p = document.createElement('span');
      p.className = 'spark';
      p.style.setProperty('--a', (k * 30 + Math.random() * 14) + 'deg');
      p.style.setProperty('--d', (38 + Math.random() * 22) + 'px');
      p.style.setProperty('--c', colors[k % colors.length]);
      box.appendChild(p); setTimeout(() => p.remove(), 750);
    }
  }

  function renderTop() {
    renderMachine();
    for (const b of document.querySelectorAll('#sysbar [data-sys]')) b.setAttribute('aria-pressed', !st.view && b.dataset.sys === st.sys);
    const tabs = st.sys === 'splice' ? [['pick', T('tPick')], ['how', T('tHow')], ['use', T('tUse')]] : st.sys === 'items' ? [] : [['list', T('tList')], ['item', T('tItem')]];
    const cur = st.view ? '' : st.sys === 'splice' ? st.tab : st.gtab;
    $('tabs').hidden = !tabs.length || !!st.view;
    $('tabs').style.setProperty('--n', tabs.length || 1);
    $('tabs').innerHTML = `<span class="tabpill" style="transform:translateX(${Math.max(0, tabs.findIndex(t => t[0] === cur)) * 100}%)" aria-hidden="true"></span>` +
      tabs.map(([k, l]) => `<button class="tab" role="tab" type="button" data-tab="${k}" aria-selected="${k === cur}">${esc(l)}</button>`).join('');
    const ph = st.view ? T('phItems') : st.sys === 'items' ? T('phItems') : st.sys !== 'splice' ? T('phSys') : st.tab === 'pick' ? ({ s1: T('ph1'), s2: T('ph2'), r: T('phR') })[st.act] : st.tab === 'use' ? T('phU') : T('phH');
    $('q').placeholder = ph;
    $('back').disabled = !history.length;
  }

  /* ================================================================ Rows */
  const chip = n => `<button class="ich" type="button" data-go="${esc(n)}">${seed(n)}${esc(n)}</button>`;
  function details(name) {
    const mk = (makers.get(name) || []).filter(x => x.s === st.sys || st.sys === 'items');
    const u = usedBy.get(name) || [];
    let from = '';
    if (st.sys === 'splice') { const x = byRes.get(name); from = x ? `<div class="chs">${chip(x.a)}<i>+</i>${chip(x.b)}</div>` : `<em>${esc(T('baseNote'))}</em>`; }
    else from = mk.length ? mk.slice(0, 3).map(({ s, i }) => `<div class="chs">${R[s][i].ins.map(x => chip(x.n) + (x.q > 1 ? `<i>×${x.q}</i>` : '')).join(R[s][i].alt ? `<i>${esc(T('orAlt'))}</i>` : '<i>+</i>') || `<em>${esc(summary(s, R[s][i]))}</em>`}</div>`).join('') : `<em>${esc(T('baseNote'))}</em>`;
    const outs = [...new Set(u.map(({ s, i }) => R[s][i].out))].sort((a, b) => a.localeCompare(b));
    const into = outs.length ? `<div class="chs">${outs.slice(0, 10).map(chip).join('')}${outs.length > 10 ? `<button class="ich all" type="button" data-item="${esc(name)}">${esc(T('seeAll'))} (${outs.length})</button>` : ''}</div>` : `<em>${esc(T('noInto'))}</em>`;
    return `<div class="det"><div class="dl"><span>${ICON.from}${esc(T('madeFrom'))}</span>${from}</div><div class="dl"><span>${ICON.into}${esc(T('into'))}${outs.length ? ' (' + outs.length + ')' : ''}</span>${into}</div>` +
      `<button class="view" type="button" data-item="${esc(name)}">${esc(T('open'))}${ICON.arrow}</button></div>`;
  }
  function row(name, sub, attrs, cur, sprout) {
    const open = st.open.has(name);
    return `<div class="it${cur ? ' cur' : ''}${open ? ' open' : ''}"><div class="top2">` +
      `<button class="main" type="button" ${attrs}>${seed(name, sprout)}<span><b>${esc(name)}</b><small>${sub}</small></span></button>` +
      `<button class="exp" type="button" data-exp="${esc(name)}" aria-expanded="${open}" aria-label="${esc(T('details')(name))}"><span>${ICON.chevron}</span></button>` +
      `</div>${open ? details(name) : ''}</div>`;
  }
  const head = (title, count) => `<div class="head"><h2>${esc(title)}</h2><span>${esc(count)}</span></div>`;
  function listOut(items) {
    if (!items.length) return `<p class="empty">${esc(T('none'))}</p>`;
    return `<div class="list">${items.slice(0, st.lim).map((h, i) => h.replace('<div class="it', `<div style="--i:${i}" class="it`)).join('')}</div>` +
      (items.length > st.lim ? `<button class="more" id="more" type="button">${esc(T('more')(items.length - st.lim))}</button>` : '');
  }
  const chips = (key, values, labelOf) => `<div class="chips">${values.map(v => `<button class="chip" type="button" data-${key}="${esc(v)}" aria-pressed="${String((st.cat[st.sys] || '') === v)}">${esc(labelOf(v))}</button>`).join('')}</div>`;

  /* ================================================================ Splicing views */
  const spRow = (x, cur) => row(x.r, `${esc(x.a)} + ${esc(x.b)} · T${x.t}${x.ev ? ` <span class="old">· ${esc(T('event')[x.ev])}</span>` : ''}`, `data-pick="r" data-n="${esc(x.r)}"`, cur, true);
  function pickView() {
    const a = st.act, q = st.q.trim().toLowerCase(), other = a === 's1' ? st.s2 : a === 's2' ? st.s1 : null;
    if (a === 'r') {
      const it = spResults.filter(x => (!st.tier || x.t === st.tier) && match(q, x.r, x.a, x.b)).map(x => spRow(x, x.r === st.r));
      const tc = [0, ...spTiers].map(t => `<button class="chip" type="button" data-tier="${t}" aria-pressed="${st.tier === t}">${t ? 'Tier ' + t : esc(T('allT'))}</button>`).join('');
      return head(T('pickR'), T('recipes')(it.length)) + `<div class="chips">${tc}</div>` + listOut(it);
    }
    const toggle = other ? `<div class="chips"><button class="chip" type="button" data-all="0" aria-pressed="${!st.all}">${esc(T('withX')(other))}</button><button class="chip" type="button" data-all="1" aria-pressed="${st.all}">${esc(T('allSeeds'))}</button></div>` : '';
    let it;
    if (other && !st.all) {
      const seen = new Set();
      it = (spUses.get(other) || []).map(x => ({ p: x.a === other ? x.b : x.a, x })).filter(o => !seen.has(o.p) && seen.add(o.p))
        .map(o => ({ ...o, all: pairAll.get(key(o.p, other)) || [o.x.r] })).filter(o => match(q, o.p, ...o.all)).sort((m, n) => m.p.localeCompare(n.p))
        .map(o => row(o.p, `→ ${esc(o.all.length > 1 ? T('randomOf')(o.all.length) + ': ' + short(o.all) : o.x.r)} · T${o.x.t}`, `data-pick="${a}" data-n="${esc(o.p)}"`, o.p === st[a]));
    } else {
      it = spIngredients.filter(n => match(q, n)).map(n => {
        const x = other ? byPair.get(key(n, other)) : null;
        const many = x ? pairAll.get(key(n, other)) || [] : [];
        const sub = x ? `→ ${esc(many.length > 1 ? T('randomOf')(many.length) + ': ' + short(many) : x.r)}` : `${esc(T('usedIn')(spUses.get(n).length))} · ${byRes.has(n) ? 'T' + byRes.get(n).t : esc(T('base'))}`;
        return row(n, sub, `data-pick="${a}" data-n="${esc(n)}"`, n === st[a]);
      });
    }
    return head(T('pickS')(a[1]), T('items')(it.length)) + toggle + listOut(it);
  }
  function need(name, memo) {
    if (memo.has(name)) return memo.get(name);
    const x = byRes.get(name); let m;
    if (!x) m = new Map([[name, 1]]);
    else { memo.set(name, new Map([[name, 1]])); m = new Map(); for (const s of [x.a, x.b]) for (const [k, v] of need(s, memo)) m.set(k, (m.get(k) || 0) + v); }
    memo.set(name, m); return m;
  }
  function tree(name, depth, path) {
    const x = byRes.get(name);
    if (!x || depth > 14 || path.has(name)) return `<li><button class="leaf" type="button" data-go="${esc(name)}" title="${esc(T('baseGo')(name))}"><span class="dotbase"></span>${seed(name)}<span>${esc(name)}</span><span class="badge${x ? '' : ' base'}">${x ? '…' : esc(T('base'))}</span></button></li>`;
    const p = new Set(path).add(name);
    const goBtn = depth ? `<button class="view" type="button" data-go="${esc(name)}">${esc(T('load'))}${ICON.arrow}</button>` : '';
    return `<li><details${depth < 2 ? ' open' : ''}><summary>${seed(name)}<b>${esc(name)}</b><span class="badge">T${x.t}</span>${goBtn}</summary><ul>${tree(x.a, depth + 1, p)}${tree(x.b, depth + 1, p)}</ul></details></li>`;
  }
  const short = list => list.slice(0, 3).join(', ') + (list.length > 3 ? ', …' : '');
  const wikiPage = n => (ITEMS.page && ITEMS.page[IX.get(n)]) || n;   // items that share one wiki page
  const wikiURL = n => 'https://growtopiawiki.com/w/' + encodeURIComponent(wikiPage(n).replace(/ /g, '_'));
  const wikiLinks = names => `<p class="wiki">${esc(T('wiki'))} ` + names.filter(Boolean).map(n => `<a target="_blank" rel="noopener" href="${esc(wikiURL(n))}">${esc(n)}</a>`).join(' · ') + '</p>';
  function howView() {
    const q = st.q.trim().toLowerCase();
    if (q) { const it = spResults.filter(x => match(q, x.r)).map(x => spRow(x, false)); return head(T('search'), T('recipes')(it.length)) + listOut(it); }
    if (!st.r) return `<p class="empty">${esc(T('noRes'))}</p>`;
    const req = [...need(st.r, new Map())].sort((a, b) => b[1] - a[1]);
    return head(T('how')(st.r), T('fold')) + wikiLinks([st.r, st.s1, st.s2]) + `<ul class="tree">${tree(st.r, 0, new Set())}</ul>` +
      `<p class="sec">${esc(T('need'))}</p><ul class="need">${req.map(([k, v]) => `<li>${seed(k)}${esc(k)} <b>×${v.toLocaleString()}</b></li>`).join('')}</ul>`;
  }
  function useView() {
    const opts = [...new Set([st.r, st.s1, st.s2, st.subj].filter(Boolean))];
    if (!opts.length) return `<p class="empty">${esc(T('noSel'))}</p>`;
    const n = st.subj && opts.includes(st.subj) ? st.subj : opts[0], q = st.q.trim().toLowerCase();
    const it = (spUses.get(n) || []).filter(x => match(q, x.r, x.a, x.b)).map(x => spRow(x, false));
    const sc = opts.length > 1 ? `<div class="chips">${opts.map(o => `<button class="chip" type="button" data-subj="${esc(o)}" aria-pressed="${o === n}">${esc(o)}</button>`).join('')}</div>` : '';
    return head(T('useT')(n), T('recipes')(it.length)) + sc + listOut(it);
  }

  /* ================================================================ Other systems */
  function catsOf(s) {
    if (s === 'combine') return ['', ...D.cats];
    if (s === 'other') return ['', ...new Set(R.other.map(r => r.how))];
    return null;
  }
  const catLabel = s => v => !v ? T('allT') : s === 'other' ? T('other')[v] : v.replace('Event: ', '★ ').replace('Other', T('catOther'));
  function listView() {
    const s = st.sys, q = st.q.trim().toLowerCase(), cat = st.cat[s] || '';
    const it = sorted[s].filter(i => { const r = R[s][i]; return (!cat || r.cat === cat) && match(q, r.out, ...r.ins.map(x => x.n)); })
      .sort((a, b) => rank(q, R[s][a].out) - rank(q, R[s][b].out) || R[s][a].out.localeCompare(R[s][b].out))
      .map(i => { const r = R[s][i]; return row(r.out, esc(summary(s, r)), `data-open="${s}:${i}"`, st.sel[s] === i, true); });
    const cs = catsOf(s);
    return head(sysName(s), T('recipes')(it.length)) + `<p class="hintline">${esc(T('sysHint')[s])}</p>` + (cs ? chips('cat', cs, catLabel(s)) : '') + listOut(it);
  }
  function recipeCard(s, i, withSys) {
    const r = R[s][i];
    let body;
    if (s === 'cook') {
      body = `<ol class="timeline">${r.ins.map(x => `<li class="${x.opt ? 'opt' : ''}"><span class="time">${esc(x.tag === 'Anytime' ? T('anytime') : x.tag)}</span>${chip(x.n)}${x.q > 1 ? `<i>×${x.q}</i>` : ''}${x.opt ? `<em>${esc(T('optSpice'))}</em>` : ''}</li>`).join('')}` +
        (r.punch ? `<li class="punch"><span class="time">${esc(r.punch)}</span><b>${esc(T('punch'))}</b></li>` : '') + '</ol>';
    } else if (s === 'sew') {
      body = `<ol class="timeline">${r.ins.map((x, k) => `<li><span class="time">${k ? k + 1 : 1}</span><div class="step"><em>${esc(k ? T('thenSew') + ' · ' + x.tag : T('startWith'))}</em>${chip(x.n)}</div></li>`).join('')}</ol>`;
    } else if (r.ins.length) {
      body = `<div class="chs">${r.ins.map(x => chip(x.n) + (x.q > 1 ? `<i>×${x.q}</i>` : '')).join(r.alt ? `<i>${esc(T('orAlt'))}</i>` : '<i>+</i>')}<i>→</i>${chip(r.out)}${r.y > 1 ? `<i>×${r.y}</i>` : ''}</div>`;
    } else body = `<p class="note">${esc(summary(s, r))}</p>`;
    const meta = metaText(s, r);
    const hd = (withSys ? `<span class="badge">${esc(sysName(s))}</span>` : '') + (meta ? `<span class="tag">${esc(meta)}</span>` : '') + (withSys ? `<button class="view" type="button" data-open="${s}:${i}">${esc(T('load'))}${ICON.arrow}</button>` : '');
    return `<div class="card">${hd ? `<div class="card-h">${hd}</div>` : ''}${body}</div>`;
  }
  function selectedView() {
    const s = st.sys, i = st.sel[s];
    if (i == null) return `<p class="empty">${esc(T('pickRecipe'))}</p>`;
    return itemBody(R[s][i].out, s, i);
  }

  /* ================================================================ Item details (all systems) */
  function itemBody(name, focusSys, focusI) {
    const ix = IX.get(name), mk = makers.get(name) || [], u = usedBy.get(name) || [], ob = ITEMS.obtain[ix] || [];
    let h = head(name, '') + (ITEMS.desc[ix] ? `<p class="desc">${esc(ITEMS.desc[ix])}</p>` : '') + wikiLinks([name]);
    if (focusSys) h += recipeCard(focusSys, focusI, false);
    const others = mk.filter(x => !(x.s === focusSys && x.i === focusI));
    if (others.length) h += `<p class="sec">${esc(T('itemMakes'))}</p>` + others.map(({ s, i }) => recipeCard(s, i, true)).join('');
    if (ob.length) h += `<p class="sec">${esc(T('itemObtain'))}</p><ul class="obtain">${ob.map(([k, txt]) => `<li><span class="badge">${esc((T('obtain')[k]) || k)}</span><span>${esc(txt)}</span></li>`).join('')}</ul>`;
    if (!mk.length && !ob.length) h += `<p class="empty">${esc(T('itemNone'))}</p>`;
    if (u.length) {
      const g = {};
      for (const { s, i } of u) (g[s] = g[s] || new Set()).add(R[s][i].out);
      h += `<p class="sec">${esc(T('itemUsed'))}</p>` + Object.entries(g).map(([s, set]) => `<div class="usedgrp"><span class="badge">${esc(sysName(s))}</span><div class="chs">${[...set].sort().map(chip).join('')}</div></div>`).join('');
    }
    return h;
  }
  function itemsView() {
    const q = st.q.trim().toLowerCase();
    const list = q ? allNames.filter(n => n.toLowerCase().includes(q)).sort((a, b) => rank(q, a) - rank(q, b) || a.localeCompare(b)) : allNames;
    const rows = list.slice(0, st.lim).map(n => {
      const mk = [...new Set((makers.get(n) || []).map(x => sysName(x.s)))];
      const ob = (ITEMS.obtain[IX.get(n)] || []).map(x => T('obtain')[x[0]] || x[0]);
      return row(n, esc([...mk, ...new Set(ob)].slice(0, 4).join(' · ') || '—'), `data-item="${esc(n)}"`, false, true);
    });
    const html = rows.length ? listOut(rows) : `<p class="empty">${esc(T('none'))}</p>`;
    return head(sysName('items'), T('items')(list.length)) + `<p class="hintline">${esc(T('sysHint').items)}</p>` + html +
      (list.length > st.lim ? `<button class="more" id="more" type="button">${esc(T('more')(list.length - st.lim))}</button>` : '');
  }

  /* ================================================================ Render */
  let more = null;
  function renderMain() {
    const main = $('main');
    main.classList.toggle('anim', st.anim);
    let html;
    if (st.view === 'item') html = itemBody(st.item);
    else if (st.sys === 'splice') html = st.tab === 'pick' ? pickView() : st.tab === 'how' ? howView() : useView();
    else if (st.sys === 'items') html = itemsView();
    else html = st.gtab === 'item' ? selectedView() : listView();
    main.innerHTML = html;
    st.anim = false;
    const m = $('more');
    if (more) more.disconnect();
    if (m && 'IntersectionObserver' in window) {
      more = new IntersectionObserver(e => { if (e[0].isIntersecting) { st.lim += 120; renderMain(); } }, { rootMargin: '400px' });
      more.observe(m);
    }
  }
  function renderSysbar() {
    const count = s => s === 'items' ? N.length : s === 'splice' ? spResults.length : R[s].length;
    $('sysbar').innerHTML = SYS.map(s => `<button class="sysb" type="button" data-sys="${s}" aria-pressed="${s === st.sys}"><span>${esc(sysName(s))}</span><b>${count(s).toLocaleString()}</b></button>`).join('');
  }
  function applyLang() {
    document.documentElement.lang = lang;
    for (const el of document.querySelectorAll('[data-ia]')) { el.setAttribute('aria-label', T(el.dataset.ia)); el.title = T(el.dataset.ia); }
    $('langT').textContent = I18N[nextLang()].short;
    $('lang').setAttribute('aria-label', I18N[nextLang()].switchTo);
    $('foot').innerHTML = T('foot').replace('{date}', esc(D.fetched || ''));
    renderSysbar(); applyTheme();
  }
  function render() { renderTop(); renderMain(); }
  function toggleRow(btn) {
    const n = btn.dataset.exp, item = btn.closest('.it'), open = st.open.has(n);
    btn.setAttribute('aria-expanded', !open);
    if (open) {
      st.open.delete(n); item.classList.remove('open');
      const d = item.querySelector('.det'); if (!d) return;
      if (reduced()) return d.remove();
      d.classList.add('closing'); setTimeout(() => d.remove(), 200);
    } else { st.open.add(n); item.classList.add('open'); item.insertAdjacentHTML('beforeend', details(n)); }
  }

  /* ================================================================ Events */
  document.addEventListener('click', e => {
    const t = e.target;
    const g = t.closest('[data-go]'); if (g) { e.preventDefault(); return go(g.dataset.go); }
    const o = t.closest('[data-open]'); if (o) { const [s, i] = o.dataset.open.split(':'); return openRecipe(s, +i); }
    const it = t.closest('[data-item]'); if (it) return openItem(it.dataset.item);
    const w = t.closest('[data-wiki]'); if (w) { window.open(wikiURL(w.dataset.wiki), '_blank', 'noopener'); return; }
    const sb = t.closest('[data-sys]'); if (sb) { remember(); st.sys = sb.dataset.sys; st.view = null; st.gtab = 'list'; sb.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); return done(); }
    const slot = t.closest('[data-slot]'); if (slot) { st.act = slot.dataset.slot; st.tab = 'pick'; st.all = false; st.view = null; return done(); }
    const pick = t.closest('[data-pick]'); if (pick) return setSlot(pick.dataset.pick, pick.dataset.n);
    const exp = t.closest('[data-exp]'); if (exp) return toggleRow(exp);
    const tab = t.closest('[data-tab]'); if (tab) { if (st.sys === 'splice') st.tab = tab.dataset.tab; else st.gtab = tab.dataset.tab; return done(); }
    const tier = t.closest('[data-tier]'); if (tier) { st.tier = +tier.dataset.tier; st.lim = 80; st.anim = true; return renderMain(); }
    const cat = t.closest('[data-cat]'); if (cat) { st.cat[st.sys] = cat.dataset.cat; st.lim = 80; st.anim = true; return renderMain(); }
    const al = t.closest('[data-all]'); if (al) { st.all = al.dataset.all === '1'; st.lim = 80; st.anim = true; return renderMain(); }
    const sj = t.closest('[data-subj]'); if (sj) { st.subj = sj.dataset.subj; st.lim = 80; st.anim = true; return renderMain(); }
    if (t.closest('#more')) { st.lim += 120; renderMain(); }
  });
  $('swap').addEventListener('click', () => { $('swap').classList.toggle('spin'); [st.s1, st.s2] = [st.s2, st.s1]; if (st.act !== 'r') st.act = st.act === 's1' ? 's2' : 's1'; render(); });
  $('back').addEventListener('click', () => {
    const s = history.pop(); if (!s) return;
    Object.assign(st, JSON.parse(s)); done();
  });
  $('clear').addEventListener('click', () => {
    remember();
    st.view = null;
    if (st.sys === 'splice') { st.s1 = st.s2 = st.r = st.subj = null; st.act = 's1'; st.tab = 'pick'; st.all = false; st.tier = 0; }
    else { delete st.sel[st.sys]; st.cat[st.sys] = ''; st.gtab = 'list'; }
    done();
  });
  $('lang').addEventListener('click', () => { lang = nextLang(); store.set('gsLang', lang); applyLang(); render(); });
  $('theme').addEventListener('click', () => { theme = currentTheme() === 'dark' ? 'light' : 'dark'; store.set('gsTheme', theme); applyTheme(); });
  $('q').addEventListener('input', e => { st.q = e.target.value; st.lim = 80; st.anim = false; renderMain(); });

  applyLang();
  render();
})();
