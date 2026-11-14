import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=4';
import { STRINGS, PLACE_ICONS, CRITERIA } from './strings.js?v=4';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const app = document.getElementById('app');
const BUCKET = 'photos';

let memories = [];          // newest first, each with .photos [{id, path}] and .ratings
let me = null;              // signed-in user {id, email}
let names = {};             // email -> name from the members table
let urls = {};              // storage path -> signed URL
let leaflet = null;         // current Leaflet map, removed on each re-render
let calDate = null;         // any day inside the calendar month being shown
let lang = 'fa';
try { lang = localStorage.getItem('lang') === 'en' ? 'en' : 'fa'; } catch {}
let T = STRINGS[lang];

function applyLang() {
  T = STRINGS[lang];
  document.documentElement.lang = lang;
  document.documentElement.dir = T.dir;
  document.title = T.appName;
  document.querySelectorAll('[data-t]').forEach(el => (el.textContent = T[el.dataset.t]));
}
applyLang();
function toggleLang() {
  lang = lang === 'fa' ? 'en' : 'fa';
  try { localStorage.setItem('lang', lang); } catch {}
  applyLang(); route();
}
document.getElementById('lang').onclick = toggleLang;

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toDate = s => new Date(s + 'T00:00');
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// fa-IR formats in the Jalali calendar, en in Gregorian.
const fmtDate = s => toDate(s).toLocaleDateString(T.locale, { year: 'numeric', month: 'long', day: 'numeric' });
// Built by hand because some browsers put the year first in Persian ("۱۴۰۵ آبان").
const fmtMonth = d => `${d.toLocaleDateString(T.locale, { month: 'long' })} ${d.toLocaleDateString(T.locale, { year: 'numeric' })}`;
// Day/month numbers of a date in the active calendar (Latin digits so they parse).
const calParts = d => {
  const p = Object.fromEntries(new Intl.DateTimeFormat(T.locale + '-u-nu-latn', { year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return { m: +p.month, day: +p.day };
};
const fmtDayNum = d => d.toLocaleDateString(T.locale, { day: 'numeric' });
const typeOf = k => ({ icon: PLACE_ICONS[k] || PLACE_ICONS.other, label: T.places[k] || T.places.other });
const cover = m => m.photos[0] && urls[m.photos[0].path];
const byId = id => memories.find(m => m.id === id);
const avg = rows => rows.length ? rows.reduce((s, r) => s + r.score, 0) / rows.length : null;
const fmtScore = n => n == null ? '–' : n.toLocaleString(T.locale, { maximumFractionDigits: 1 });
const critsOf = type => CRITERIA[type] || CRITERIA.other;
// Only criteria that belong to the current place type count (old ones stay stored if the type changes).
const liveRatings = m => m.ratings.filter(r => critsOf(m.place_type).includes(r.criterion));
const nameOf = email => names[email?.toLowerCase()] || email?.split('@')[0];

async function signUrls(paths) {
  const todo = paths.filter(p => !urls[p]);
  if (!todo.length) return;
  // shortcut: links last 1h and are cached for the page's life; a tab left open longer needs a reload.
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(todo, 3600);
  if (error) throw error;
  data.forEach(d => d.signedUrl && (urls[d.path] = d.signedUrl));
}

async function loadMemories() {
  const { data, error } = await sb.from('memories')
    .select('*, photos(id, path, created_at), ratings(user_id, user_email, criterion, score)')
    .order('happened_on', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  data.forEach(m => m.photos.sort((a, b) => a.created_at.localeCompare(b.created_at)));
  memories = data;
  const mem = await sb.from('members').select('email, name');
  if (!mem.error) names = Object.fromEntries(mem.data.map(x => [x.email.toLowerCase(), x.name]));
  await signUrls(memories.flatMap(m => m.photos.map(p => p.path)));
}

// Phone photos are 3–8 MB; shrinking to 2000px keeps the free 1 GB storage lasting years.
async function shrink(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  if (!bmp) return file; // e.g. HEIC on browsers that can't decode it: upload as is
  const s = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(b => r(b || file), 'image/jpeg', 0.85));
}

function makeMap(el, center, zoom) {
  leaflet = L.map(el).setView(center, zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap',
  }).addTo(leaflet);
  return leaflet;
}

function setActiveNav(name) {
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
}

function card(m) {
  const c = cover(m), t = typeOf(m.place_type), score = avg(liveRatings(m));
  return `<a class="card" href="#/memory/${m.id}">
    <div class="cover" ${c ? `style="background-image:url('${c}')"` : ''}>${c ? '' : t.icon}</div>
    <div class="body"><h3>${esc(m.title)}${score != null ? ` <span class="score">⭐ ${fmtScore(score)}</span>` : ''}</h3>
      <div class="meta">${t.icon} ${esc(m.place_name || t.label)} · ${fmtDate(m.happened_on)}</div></div></a>`;
}

// ---------- views ----------
function loginView(msg = '') {
  document.getElementById('top').hidden = true;
  app.innerHTML = `<div class="login"><h1>💛 ${T.appName}</h1>
    <form id="login">
      <label>${T.email}<input name="email" type="email" required autocomplete="username"></label>
      <label>${T.password}<input name="password" type="password" required autocomplete="current-password"></label>
      <p class="error">${esc(msg)}</p>
      <button class="primary">${T.signIn}</button>
    </form><button class="link" id="lang2">${T.switchTo}</button></div>`;
  app.querySelector('#lang2').onclick = toggleLang;
  app.querySelector('#login').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    e.target.querySelector('button').disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: f.get('email'), password: f.get('password') });
    if (error) loginView(error.message); else route();
  };
}

function timelineView(filter, best) {
  setActiveNav('timeline');
  const list = filter ? memories.filter(m => m.place_type === filter) : memories.slice();
  const link = (type, b) => '#/?' + new URLSearchParams({ ...(type && { type }), ...(b && { sort: 'best' }) });
  const chips = [['', T.all], ...Object.keys(PLACE_ICONS).map(k => [k, `${PLACE_ICONS[k]} ${T.places[k]}`])]
    .map(([k, l]) => `<a class="chip ${k === (filter || '') ? 'active' : ''}" href="${link(k, best)}">${l}</a>`).join('');
  const sorts = `<a class="chip ${best ? '' : 'active'}" href="${link(filter, false)}">${T.sortNewest}</a>
    <a class="chip ${best ? 'active' : ''}" href="${link(filter, true)}">${T.sortBest}</a>`;
  let html = '', month = '';
  if (best) {
    list.sort((x, y) => (avg(liveRatings(y)) ?? -1) - (avg(liveRatings(x)) ?? -1));
    html = list.length ? `<div class="grid">${list.map(card).join('')}</div>` : '';
  } else for (const m of list) {
    const mm = fmtMonth(toDate(m.happened_on));
    if (mm !== month) {
      html += `${month ? '</div>' : ''}<h2 class="month">${mm}</h2><div class="grid">`;
      month = mm;
    }
    html += card(m);
  }
  if (month) html += '</div>';
  app.innerHTML = `<div class="chips">${sorts}<span class="sep"></span>${chips}</div>${html || `<p class="empty">${filter ? T.emptyFilter : T.empty}</p>`}`;
}

function calendarView() {
  setActiveNav('calendar');
  calDate ||= new Date();
  // Works for both Jalali and Gregorian: walk back to day 1, then forward while the month stays the same.
  const first = addDays(calDate, 1 - calParts(calDate).day);
  const month = calParts(first).m;
  const byDay = {};
  memories.forEach(x => (byDay[x.happened_on] ||= []).push(x));
  const today = isoDay(new Date());
  const wd = d => d.toLocaleDateString(T.locale, { weekday: 'short' });
  let cells = Array.from({ length: 7 }, (_, i) => `<div class="wd">${wd(addDays(first, i - ((first.getDay() - T.weekStart + 7) % 7)))}</div>`).join('');
  cells += '<div></div>'.repeat((first.getDay() - T.weekStart + 7) % 7);
  let d = first;
  for (; calParts(d).m === month; d = addDays(d, 1)) {
    const key = isoDay(d), list = byDay[key] || [];
    const c = list.map(cover).find(Boolean);
    const href = list.length === 1 ? `#/memory/${list[0].id}` : list.length ? `#/calendar?day=${key}` : null;
    const cls = `day ${list.length ? 'has' : ''} ${key === today ? 'today' : ''}`;
    const inner = `${fmtDayNum(d)}${list.length > 1 ? `<span class="n">×${list.length}</span>` : ''}`;
    cells += href
      ? `<a class="${cls}" href="${href}" title="${esc(list.map(x => x.title).join(', '))}" ${c ? `style="background-image:url('${c}')"` : ''}>${inner}</a>`
      : `<div class="${cls}">${inner}</div>`;
  }
  const day = new URLSearchParams(location.hash.split('?')[1]).get('day');
  const dayList = day && byDay[day] ? `<h2 class="month">${fmtDate(day)}</h2><div class="grid">${byDay[day].map(card).join('')}</div>` : '';
  // Buttons sit in reading order, so "previous" is on the right in Persian automatically.
  app.innerHTML = `<div class="cal-head"><button id="prev" aria-label="${T.prev}">${T.dir === 'rtl' ? '›' : '‹'}</button>
    <h2>${fmtMonth(first)}</h2><button id="next" aria-label="${T.next}">${T.dir === 'rtl' ? '‹' : '›'}</button></div>
    <div class="cal">${cells}</div>${dayList}`;
  app.querySelector('#prev').onclick = () => { calDate = addDays(first, -1); calendarView(); };
  app.querySelector('#next').onclick = () => { calDate = d; calendarView(); };
}

function mapView() {
  setActiveNav('map');
  const placed = memories.filter(m => m.lat != null);
  if (!placed.length) { app.innerHTML = `<p class="empty">${T.noLocation}</p>`; return; }
  app.innerHTML = '<div id="bigmap"></div>';
  const map = makeMap(app.querySelector('#bigmap'), [placed[0].lat, placed[0].lng], 12);
  const pts = placed.map(m => {
    const t = typeOf(m.place_type), c = cover(m);
    L.marker([m.lat, m.lng], { icon: L.divIcon({ html: `<span style="font-size:26px">${t.icon}</span>`, className: '', iconSize: [30, 30] }) })
      .addTo(map)
      .bindPopup(`<a href="#/memory/${m.id}" style="text-decoration:none">${c ? `<img src="${c}" style="width:160px;border-radius:8px;display:block">` : ''}
        <b>${esc(m.title)}</b><br><small>${fmtDate(m.happened_on)}</small></a>`);
    return [m.lat, m.lng];
  });
  if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40] });
}

function scoresTable(m) {
  const rows = liveRatings(m);
  if (!rows.length) return `<h2 class="month">${T.scores}</h2><p class="meta">${T.noScores}</p>`;
  // Me first, then whoever else has scored.
  const people = [...new Set([me.email, ...rows.map(r => r.user_email)])].filter(e => rows.some(r => r.user_email === e));
  const get = (e, c) => rows.find(r => r.user_email === e && r.criterion === c)?.score;
  const stars = n => n ? '★'.repeat(n) + '<span class="off">' + '★'.repeat(5 - n) + '</span>' : '–';
  const body = critsOf(m.place_type).filter(c => rows.some(r => r.criterion === c)).map(c =>
    `<tr><th>${T.crit[c]}</th>${people.map(e => `<td class="stars-ro">${stars(get(e, c))}</td>`).join('')}</tr>`).join('');
  const foot = `<tr><th>${T.average}</th>${people.map(e => `<td><b>${fmtScore(avg(rows.filter(r => r.user_email === e)))}</b></td>`).join('')}</tr>`;
  return `<h2 class="month">${T.scores} · ⭐ ${fmtScore(avg(rows))}</h2>
    <table class="scores"><tr><th></th>${people.map(e => `<th>${esc(nameOf(e))}</th>`).join('')}</tr>${body}${foot}</table>`;
}

function detailView(id) {
  setActiveNav('');
  const m = byId(id);
  if (!m) return (location.hash = '#/');
  const t = typeOf(m.place_type);
  app.innerHTML = `<article class="detail">
    <a href="#/" class="meta">${T.dir === 'rtl' ? '›' : '‹'} ${T.back}</a>
    <h1>${esc(m.title)}</h1>
    <div class="meta">${t.icon} ${t.label}${m.place_name ? ' · ' + esc(m.place_name) : ''} · ${fmtDate(m.happened_on)}</div>
    <div class="photos">${m.photos.map(p => `<img src="${urls[p.path]}" loading="lazy" alt="">`).join('')}</div>
    ${m.note ? `<div class="note">${esc(m.note)}</div>` : ''}
    ${scoresTable(m)}
    ${m.lat != null ? '<div class="minimap" id="mini"></div>' : ''}
    <div class="actions"><a class="btn" href="#/edit/${m.id}">${T.edit}</a><button class="danger" id="del">${T.delete}</button></div>
  </article>`;
  app.querySelectorAll('.photos img').forEach(img => (img.onclick = () => openViewer(img.src)));
  if (m.lat != null) L.marker([m.lat, m.lng]).addTo(makeMap(app.querySelector('#mini'), [m.lat, m.lng], 15));
  app.querySelector('#del').onclick = async e => {
    if (!confirm(T.confirmDelete)) return;
    e.target.disabled = true;
    try {
      if (m.photos.length) {
        const { error } = await sb.storage.from(BUCKET).remove(m.photos.map(p => p.path));
        if (error) throw error;
      }
      const { error } = await sb.from('memories').delete().eq('id', m.id);
      if (error) throw error;
      await loadMemories();
      location.hash = '#/';
    } catch (err) { alert(err.message); e.target.disabled = false; }
  };
}

function editorView(id) {
  setActiveNav(id ? '' : 'new');
  const m = id ? byId(id) : null;
  if (id && !m) return (location.hash = '#/');
  let pos = m && m.lat != null ? [m.lat, m.lng] : null;
  const opts = Object.keys(PLACE_ICONS).map(k =>
    `<option value="${k}" ${(m?.place_type || 'cafe') === k ? 'selected' : ''}>${PLACE_ICONS[k]} ${T.places[k]}</option>`).join('');
  app.innerHTML = `<form class="editor" id="ed">
    <h1>${m ? T.editMemory : T.newMemory}</h1>
    <label>${T.title}<input name="title" required maxlength="120" value="${esc(m?.title)}"></label>
    <label>${T.date}<input name="happened_on" type="date" required value="${m?.happened_on || isoDay(new Date())}">
      <span class="meta" id="datePreview"></span></label>
    <label>${T.placeType}<select name="place_type">${opts}</select></label>
    <label>${T.placeName}<input name="place_name" maxlength="120" value="${esc(m?.place_name)}"></label>
    <label>${T.note}<textarea name="note">${esc(m?.note)}</textarea></label>
    ${m?.photos.length ? `<div><b>${T.photos}</b><div class="photos">${m.photos.map(p =>
      `<label><input type="checkbox" name="remove" value="${p.id}" title="${T.removePhoto}"><img src="${urls[p.path]}" alt=""></label>`).join('')}</div></div>` : ''}
    <label>${T.addPhotos}<input name="files" type="file" accept="image/*" multiple></label>
    <div><b>${T.myScores}</b><div class="meta">${T.scoreHint}</div><div id="myScores"></div></div>
    <div><b>${T.location}</b><div class="meta">${T.locationHint}</div>
      <div class="minimap" id="pick"></div>
      <button type="button" id="here">📍 ${T.useMyLocation}</button>
      <button type="button" class="link" id="clear">${T.clearLocation}</button></div>
    <p class="error" id="err"></p>
    <div class="actions"><button class="primary" id="save">${T.save}</button>
      <a class="btn" href="${m ? '#/memory/' + m.id : '#/'}">${T.cancel}</a></div>
  </form>`;
  const form = app.querySelector('#ed');
  // shortcut: the phone's native date picker is Gregorian; we show the Jalali date beside it. A Jalali picker needs a library.
  const dateIn = form.querySelector('[name=happened_on]'), preview = form.querySelector('#datePreview');
  const showDate = () => (preview.textContent = lang === 'fa' && dateIn.value ? fmtDate(dateIn.value) : '');
  dateIn.oninput = showDate; showDate();
  // My scores: criterion -> 1..5, kept across place-type changes so switching back doesn't lose them.
  const mine = Object.fromEntries((m?.ratings || []).filter(r => r.user_id === me.id).map(r => [r.criterion, r.score]));
  const typeSel = form.querySelector('[name=place_type]'), box = form.querySelector('#myScores');
  const drawScores = () => {
    box.innerHTML = critsOf(typeSel.value).map(c => `<div class="score-row"><span>${T.crit[c]}</span><span class="stars">${
      [1, 2, 3, 4, 5].map(n => `<button type="button" data-c="${c}" data-n="${n}" class="${n <= (mine[c] || 0) ? 'on' : ''}" aria-label="${T.crit[c]} ${n}">★</button>`).join('')}</span></div>`).join('');
  };
  box.onclick = e => {
    const b = e.target.closest('button[data-c]');
    if (!b) return;
    const { c, n } = b.dataset;
    mine[c] = mine[c] === +n ? 0 : +n;
    drawScores();
  };
  typeSel.onchange = drawScores; drawScores();
  form.querySelectorAll('[name=remove]').forEach(cb => (cb.onchange = () => cb.parentElement.classList.toggle('gone', cb.checked)));

  const map = makeMap(app.querySelector('#pick'), pos || [35.6892, 51.389], pos ? 15 : 11); // default view: Tehran
  let marker = pos && L.marker(pos).addTo(map);
  const setPos = p => { pos = p; marker?.remove(); marker = p && L.marker(p).addTo(map); };
  map.on('click', e => setPos([e.latlng.lat, e.latlng.lng]));
  form.querySelector('#clear').onclick = () => setPos(null);
  form.querySelector('#here').onclick = () => navigator.geolocation?.getCurrentPosition(
    g => { setPos([g.coords.latitude, g.coords.longitude]); map.setView(pos, 16); },
    err => (form.querySelector('#err').textContent = err.message));

  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('#save');
    btn.disabled = true; btn.textContent = T.saving;
    const f = new FormData(form);
    const row = {
      title: f.get('title').trim(), happened_on: f.get('happened_on'), place_type: f.get('place_type'),
      place_name: f.get('place_name').trim() || null, note: f.get('note').trim() || null,
      lat: pos?.[0] ?? null, lng: pos?.[1] ?? null,
    };
    try {
      const q = m ? sb.from('memories').update(row).eq('id', m.id) : sb.from('memories').insert(row);
      const { data, error } = await q.select('id').single();
      if (error) throw error;
      const memId = data.id;

      const removeIds = f.getAll('remove');
      if (removeIds.length) {
        const gone = m.photos.filter(p => removeIds.includes(p.id));
        const r1 = await sb.storage.from(BUCKET).remove(gone.map(p => p.path));
        if (r1.error) throw r1.error;
        const r2 = await sb.from('photos').delete().in('id', removeIds);
        if (r2.error) throw r2.error;
      }
      for (const file of f.getAll('files').filter(x => x.size)) {
        const blob = await shrink(file);
        const ext = blob.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'img').toLowerCase();
        const path = `${memId}/${crypto.randomUUID()}.${ext}`;
        const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || file.type });
        if (up.error) throw up.error;
        const ins = await sb.from('photos').insert({ memory_id: memId, path });
        if (ins.error) throw ins.error;
      }
      const keep = critsOf(row.place_type).filter(c => mine[c]);
      if (keep.length) {
        const up = await sb.from('ratings').upsert(keep.map(c => ({ memory_id: memId, user_id: me.id, criterion: c, score: mine[c] })),
          { onConflict: 'memory_id,user_id,criterion' });
        if (up.error) throw up.error;
      }
      let del = sb.from('ratings').delete().eq('memory_id', memId).eq('user_id', me.id);
      if (keep.length) del = del.not('criterion', 'in', `(${keep.join(',')})`);
      const dr = await del;
      if (dr.error) throw dr.error;

      await loadMemories();
      location.hash = `#/memory/${memId}`;
    } catch (err) {
      form.querySelector('#err').textContent = err.message;
      btn.disabled = false; btn.textContent = T.save;
    }
  };
}

function openViewer(src) {
  const d = document.getElementById('viewer');
  d.querySelector('img').src = src;
  d.showModal();
}
document.getElementById('viewer').onclick = e => e.currentTarget.close();

// ---------- routing ----------
let loaded = false;
async function route() {
  leaflet?.remove(); leaflet = null;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { loaded = false; return loginView(); }
  me = { id: session.user.id, email: session.user.email };
  document.getElementById('top').hidden = false;
  if (!loaded) {
    app.innerHTML = `<p class="empty">${T.loading}</p>`;
    try { await loadMemories(); loaded = true; }
    catch (err) { app.innerHTML = `<p class="empty error">${esc(err.message)}</p>`; return; }
    if (!memories.length) {
      // RLS returns nothing (not an error) for non-members, so check membership explicitly.
      const { data } = await sb.rpc('is_member');
      if (data === false) { await sb.auth.signOut(); return loginView(T.notMember); }
    }
  }
  const [path, query] = location.hash.slice(1).split('?');
  const parts = (path || '/').split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  window.scrollTo(0, 0);
  if (parts[0] === 'calendar') calendarView();
  else if (parts[0] === 'map') mapView();
  else if (parts[0] === 'memory') detailView(parts[1]);
  else if (parts[0] === 'new') editorView(null);
  else if (parts[0] === 'edit') editorView(parts[1]);
  else timelineView(params.get('type'), params.get('sort') === 'best');
}

document.getElementById('signout').onclick = async () => { await sb.auth.signOut(); memories = []; urls = {}; location.hash = '#/'; route(); };
window.addEventListener('hashchange', route);
route();
