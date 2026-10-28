'use strict';

/* =====================================================================
   CampusPass frontend. Talks to the Express backend with the Fetch API.
   If you open this page from the backend (http://localhost:5000) the API
   is on the same address. If you open it with Live Server or as a file,
   it calls http://localhost:5000 instead.
   ===================================================================== */

const servedByBackend =
  location.protocol.startsWith('http') &&
  (location.port === '5000' || !['localhost', '127.0.0.1'].includes(location.hostname));
const API_BASE = servedByBackend ? '' : 'http://localhost:5000';

const state = {
  adminKey: sessionStorage.getItem('adminKey') || '',
  registerEvent: null,
  lookupEmail: '',
};

/* ---------- Small helpers ---------- */

const $ = (selector, root = document) => root.querySelector(selector);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;

const fmtDate = (iso) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

function toLocalInput(iso) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function setBusy(button, busy) {
  button.disabled = busy;
  button.classList.toggle('is-loading', busy);
}

/* Show a loading / empty / error box in a "state" element */
function showState(el, kind, title, text = '', retry) {
  el.hidden = false;
  el.className = `state ${kind === 'error' ? 'error' : ''}`;
  const spinner = kind === 'loading' ? '<div class="spinner"></div>' : '';
  el.innerHTML = `${spinner}<strong>${esc(title)}</strong>${text ? `<span>${esc(text)}</span>` : ''}${retry ? '<br /><button class="btn btn-ghost btn-sm" type="button" data-retry>Try again</button>' : ''}`;
  if (retry) $('[data-retry]', el).addEventListener('click', retry);
}
const hideState = (el) => { el.hidden = true; };

/* ---------- API (Fetch) ---------- */

class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details || [];
  }
}

async function api(path, { method = 'GET', body, admin = false } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (admin) headers['x-admin-key'] = state.adminKey;

  let res;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('Cannot reach the server. Check that the backend is running.', 0);
  }

  let payload = null;
  try { payload = await res.json(); } catch { /* empty body */ }

  if (!res.ok) {
    if (res.status === 401 && admin) adminLogout(false);
    throw new ApiError(payload?.error || `Request failed (${res.status}).`, res.status, payload?.details);
  }
  return payload?.data;
}

/* ---------- Form validation ---------- */

function setError(form, name, message) {
  const field = form.elements[name];
  const out = form.querySelector(`[data-error-for="${name}"]`);
  if (out) out.textContent = message;
  if (field) field.classList.add('invalid');
}

function clearErrors(form) {
  form.querySelectorAll('[data-error-for]').forEach((e) => { e.textContent = ''; });
  form.querySelectorAll('.invalid').forEach((e) => e.classList.remove('invalid'));
}

function validateForm(form) {
  clearErrors(form);
  let ok = true;
  [...form.elements].forEach((el) => {
    if (!el.name || !el.willValidate) return;
    if (!el.checkValidity()) {
      setError(form, el.name, el.validationMessage);
      ok = false;
    }
  });
  const firstBad = form.querySelector('.invalid');
  if (firstBad) firstBad.focus();
  return ok;
}

function showServerErrors(form, err) {
  (err.details || []).forEach((d) => setError(form, d.field, d.message));
}

/* ---------- Navbar ---------- */

const navToggle = $('#navToggle');
const navLinks = $('#navLinks');
navToggle.addEventListener('click', () => {
  const open = navLinks.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', String(open));
});
navLinks.addEventListener('click', (e) => {
  if (e.target.closest('a')) {
    navLinks.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
  }
});

/* ---------- Dialog helpers ---------- */

document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
  });
});

/* ---------- Events list ---------- */

function eventCard(ev) {
  const d = new Date(ev.event_date);
  const past = d <= new Date();
  const full = ev.spots_left <= 0;
  const pct = Math.min(100, Math.round((ev.registered / ev.capacity) * 100));
  const barClass = full ? 'full' : pct >= 80 ? 'almost' : '';

  let action;
  if (past) action = '<button class="btn btn-ghost" disabled>Event ended</button>';
  else if (full) action = '<button class="btn btn-ghost" disabled>Fully booked</button>';
  else action = `<button class="btn btn-primary" data-action="register" data-id="${esc(ev.id)}">Register</button>`;

  const seatText = full ? 'No seats left' : `${ev.spots_left} of ${ev.capacity} seats left`;

  return `
    <article class="event-card ${past ? 'is-past' : ''}">
      <div class="date-block">
        <span class="mon">${esc(d.toLocaleString(undefined, { month: 'short' }))}</span>
        <span class="day">${d.getDate()}</span>
      </div>
      <div class="event-body">
        <span class="chip">${esc(ev.category)}</span>
        <h3>${esc(ev.title)}</h3>
        ${ev.description ? `<p class="desc">${esc(ev.description)}</p>` : ''}
        <ul class="meta">
          <li>${icon('cal')}${esc(fmtDate(ev.event_date))}</li>
          <li>${icon('pin')}${esc(ev.venue)}</li>
        </ul>
        <div class="seats">
          <div class="bar ${barClass}"><span style="width:${pct}%"></span></div>
          <small>${esc(seatText)}</small>
        </div>
        ${action}
      </div>
    </article>`;
}

let eventsCache = [];

async function loadEvents({ silent = false } = {}) {
  const grid = $('#eventsGrid');
  const box = $('#eventsState');
  const params = new URLSearchParams({
    when: $('#whenFilter').value,
    category: $('#categoryFilter').value,
    search: $('#searchInput').value.trim(),
  });

  if (!silent) {
    grid.innerHTML = '';
    showState(box, 'loading', 'Loading events...');
  }

  try {
    eventsCache = await api(`/api/events?${params}`);
    if (eventsCache.length === 0) {
      grid.innerHTML = '';
      showState(box, 'empty', 'No events found', 'Try a different search, or clear the filters.');
      return;
    }
    hideState(box);
    grid.innerHTML = eventsCache.map(eventCard).join('');
  } catch (err) {
    if (silent) return;
    grid.innerHTML = '';
    showState(box, 'error', 'Could not load events', err.message, () => loadEvents());
  }
}

/* Hero ticket: the next upcoming event that still has seats */
async function loadHero() {
  const ticket = $('#heroTicket');
  try {
    const events = await api('/api/events?when=upcoming');
    const next = events.find((e) => e.spots_left > 0);
    if (!next) {
      ticket.innerHTML = '<p class="ticket-empty">No upcoming events with open seats yet. Check back soon.</p>';
      return;
    }
    ticket.innerHTML = `
      <p class="ticket-label">Next up</p>
      <h3>${esc(next.title)}</h3>
      <div class="ticket-meta">
        <span>${icon('cal')}${esc(fmtDate(next.event_date))}</span>
        <span>${icon('pin')}${esc(next.venue)}</span>
      </div>
      <div class="tear"></div>
      <div class="ticket-foot">
        <strong>${next.spots_left} seats left</strong>
        <button class="btn btn-primary btn-sm" data-action="register" data-id="${esc(next.id)}" type="button">Register</button>
      </div>`;
  } catch (err) {
    ticket.innerHTML = `<p class="ticket-empty">${esc(err.message)}</p>`;
  }
}

$('#searchInput').addEventListener('input', debounce(() => loadEvents(), 300));
$('#categoryFilter').addEventListener('change', () => loadEvents());
$('#whenFilter').addEventListener('change', () => loadEvents());
$('#clearFilters').addEventListener('click', () => {
  $('#searchInput').value = '';
  $('#categoryFilter').value = 'all';
  $('#whenFilter').value = 'upcoming';
  loadEvents();
});

/* ---------- Register ---------- */

async function openRegister(id) {
  let ev = eventsCache.find((e) => e.id === id);
  if (!ev) {
    try { ev = await api(`/api/events/${encodeURIComponent(id)}`); }
    catch (err) { toast(err.message, 'error'); return; }
  }
  state.registerEvent = ev;
  const form = $('#registerForm');
  form.reset();
  clearErrors(form);
  $('#registerTitle').textContent = `Register for ${ev.title}`;
  $('#registerSub').textContent = `${fmtDate(ev.event_date)} at ${ev.venue}`;
  $('#registerModal').showModal();
  $('#regName').focus();
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="register"]');
  if (btn) openRegister(btn.dataset.id);
});

$('#registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (!validateForm(form)) return;

  const submit = $('#registerSubmit');
  const body = {
    student_name: form.elements.student_name.value.trim(),
    email: form.elements.email.value.trim(),
    roll_number: form.elements.roll_number.value.trim(),
    department: form.elements.department.value.trim(),
    year: Number(form.elements.year.value),
  };

  setBusy(submit, true);
  try {
    await api(`/api/events/${encodeURIComponent(state.registerEvent.id)}/register`, { method: 'POST', body });
    $('#registerModal').close();
    toast(`You are registered for ${state.registerEvent.title}.`);
    $('#lookupEmail').value = body.email;
    refreshAll();
  } catch (err) {
    showServerErrors(form, err);
    toast(err.message, 'error');
    if (err.status === 409) refreshAll();
  } finally {
    setBusy(submit, false);
  }
});

/* ---------- My registrations ---------- */

async function loadMyRegistrations(email) {
  const list = $('#myRegList');
  const box = $('#myRegState');
  list.innerHTML = '';
  showState(box, 'loading', 'Looking up your seats...');
  try {
    const regs = await api(`/api/registrations?email=${encodeURIComponent(email)}`);
    state.lookupEmail = email;
    if (regs.length === 0) {
      showState(box, 'empty', 'No registrations yet', 'Pick an event above and register to see it here.');
      return;
    }
    hideState(box);
    list.innerHTML = regs.map((r) => {
      const ev = r.events || {};
      const past = new Date(ev.event_date) <= new Date();
      return `
        <div class="reg-item">
          <div>
            <h3>${esc(ev.title || 'Event removed')}</h3>
            <p>${esc(ev.event_date ? fmtDate(ev.event_date) : '')} ${ev.venue ? '· ' + esc(ev.venue) : ''}</p>
            <p>Registered as ${esc(r.student_name)} (${esc(r.roll_number)})</p>
          </div>
          <button class="btn btn-danger btn-sm" data-cancel="${esc(r.id)}" ${past ? 'disabled title="This event has ended"' : ''}>Cancel seat</button>
        </div>`;
    }).join('');
  } catch (err) {
    showState(box, 'error', 'Could not load registrations', err.message);
  }
}

$('#lookupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateForm(e.target)) return;
  const btn = $('#lookupBtn');
  setBusy(btn, true);
  await loadMyRegistrations($('#lookupEmail').value.trim().toLowerCase());
  setBusy(btn, false);
});

$('#myRegList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-cancel]');
  if (!btn) return;
  if (!confirm('Cancel this registration? Your seat will be released.')) return;
  setBusy(btn, true);
  try {
    await api(`/api/registrations/${encodeURIComponent(btn.dataset.cancel)}?email=${encodeURIComponent(state.lookupEmail)}`, { method: 'DELETE' });
    toast('Registration cancelled.');
    refreshAll();
  } catch (err) {
    toast(err.message, 'error');
    setBusy(btn, false);
  }
});

/* ---------- Admin ---------- */

function renderAdminVisibility() {
  const loggedIn = Boolean(state.adminKey);
  $('#adminLoginForm').hidden = loggedIn;
  $('#adminPanel').hidden = !loggedIn;
}

function adminLogout(showMessage = true) {
  state.adminKey = '';
  sessionStorage.removeItem('adminKey');
  renderAdminVisibility();
  if (showMessage) toast('Organizer area locked.');
}

$('#adminLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (!validateForm(form)) return;
  const btn = $('#adminLoginBtn');
  state.adminKey = form.elements.password.value;
  setBusy(btn, true);
  try {
    await api('/api/admin/login', { method: 'POST', admin: true });
    sessionStorage.setItem('adminKey', state.adminKey);
    form.reset();
    renderAdminVisibility();
    toast('Organizer area unlocked.');
    loadAdminEvents();
  } catch (err) {
    state.adminKey = '';
    setError(form, 'password', err.status === 401 ? 'Wrong password.' : err.message);
  } finally {
    setBusy(btn, false);
  }
});

$('#logoutBtn').addEventListener('click', () => adminLogout());

async function loadAdminEvents() {
  if (!state.adminKey) return;
  const body = $('#adminEventsBody');
  const box = $('#adminState');
  showState(box, 'loading', 'Loading events...');
  try {
    const events = await api('/api/events?when=all');
    if (events.length === 0) {
      body.innerHTML = '';
      showState(box, 'empty', 'No events yet', 'Use "Add event" to create the first one.');
      return;
    }
    hideState(box);
    body.innerHTML = events.map((ev) => `
      <tr>
        <td><strong>${esc(ev.title)}</strong><br /><small>${esc(ev.category)} · ${esc(ev.venue)}</small></td>
        <td>${esc(fmtDate(ev.event_date))}</td>
        <td>${ev.registered} / ${ev.capacity}</td>
        <td>
          <div class="row-actions">
            <button class="btn btn-ghost btn-sm" data-admin="attendees" data-id="${esc(ev.id)}" data-title="${esc(ev.title)}">Attendees</button>
            <button class="btn btn-ghost btn-sm" data-admin="edit" data-id="${esc(ev.id)}">Edit</button>
            <button class="btn btn-danger btn-sm" data-admin="delete" data-id="${esc(ev.id)}" data-title="${esc(ev.title)}">Delete</button>
          </div>
        </td>
      </tr>`).join('');
    adminEvents = events;
  } catch (err) {
    showState(box, 'error', 'Could not load events', err.message, loadAdminEvents);
  }
}
let adminEvents = [];

function openEventForm(ev) {
  const form = $('#eventForm');
  form.reset();
  clearErrors(form);
  $('#evId').value = ev ? ev.id : '';
  $('#eventModalTitle').textContent = ev ? 'Edit event' : 'Add event';
  if (ev) {
    form.elements.title.value = ev.title;
    form.elements.description.value = ev.description || '';
    form.elements.venue.value = ev.venue;
    form.elements.category.value = ev.category;
    form.elements.event_date.value = toLocalInput(ev.event_date);
    form.elements.capacity.value = ev.capacity;
  }
  $('#eventModal').showModal();
  $('#evTitle').focus();
}

$('#newEventBtn').addEventListener('click', () => openEventForm(null));

$('#eventForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (!validateForm(form)) return;

  const id = $('#evId').value;
  const body = {
    title: form.elements.title.value.trim(),
    description: form.elements.description.value.trim(),
    venue: form.elements.venue.value.trim(),
    category: form.elements.category.value,
    event_date: new Date(form.elements.event_date.value).toISOString(),
    capacity: Number(form.elements.capacity.value),
  };

  const submit = $('#eventSubmit');
  setBusy(submit, true);
  try {
    await api(id ? `/api/events/${encodeURIComponent(id)}` : '/api/events', { method: id ? 'PUT' : 'POST', body, admin: true });
    $('#eventModal').close();
    toast(id ? 'Event updated.' : 'Event created.');
    refreshAll();
  } catch (err) {
    showServerErrors(form, err);
    toast(err.message, 'error');
  } finally {
    setBusy(submit, false);
  }
});

$('#adminEventsBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-admin]');
  if (!btn) return;
  const { id, title } = btn.dataset;

  if (btn.dataset.admin === 'edit') {
    const ev = adminEvents.find((x) => x.id === id);
    if (ev) openEventForm(ev);
  }

  if (btn.dataset.admin === 'delete') {
    if (!confirm(`Delete "${title}" and all of its registrations? This cannot be undone.`)) return;
    setBusy(btn, true);
    try {
      await api(`/api/events/${encodeURIComponent(id)}`, { method: 'DELETE', admin: true });
      toast('Event deleted.');
      refreshAll();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(btn, false);
    }
  }

  if (btn.dataset.admin === 'attendees') openAttendees(id, title);
});

/* Attendees */
let attendeesEventId = null;

async function openAttendees(id, title) {
  attendeesEventId = id;
  $('#attendeesTitle').textContent = `Attendees: ${title}`;
  $('#attendeesModal').showModal();
  await loadAttendees();
}

async function loadAttendees() {
  const box = $('#attendeesState');
  const table = $('#attendeesTable');
  table.hidden = true;
  showState(box, 'loading', 'Loading attendees...');
  try {
    const rows = await api(`/api/events/${encodeURIComponent(attendeesEventId)}/registrations`, { admin: true });
    if (rows.length === 0) {
      showState(box, 'empty', 'Nobody has registered yet');
      return;
    }
    hideState(box);
    table.hidden = false;
    $('#attendeesBody').innerHTML = rows.map((r) => `
      <tr>
        <td>${esc(r.student_name)}</td><td>${esc(r.email)}</td><td>${esc(r.roll_number)}</td>
        <td>${esc(r.department)}</td><td>${r.year}</td>
        <td><button class="btn btn-danger btn-sm" data-remove="${esc(r.id)}">Remove</button></td>
      </tr>`).join('');
  } catch (err) {
    showState(box, 'error', 'Could not load attendees', err.message, loadAttendees);
  }
}

$('#attendeesBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-remove]');
  if (!btn || !confirm('Remove this student from the event?')) return;
  setBusy(btn, true);
  try {
    await api(`/api/registrations/${encodeURIComponent(btn.dataset.remove)}`, { method: 'DELETE', admin: true });
    toast('Student removed.');
    refreshAll();
  } catch (err) {
    toast(err.message, 'error');
    setBusy(btn, false);
  }
});

/* ---------- Refresh everything + live updates (WebSocket) ---------- */

function refreshAll() {
  loadEvents({ silent: true });
  loadHero();
  loadAdminEvents();
  if ($('#attendeesModal').open && attendeesEventId) loadAttendees();
  if (state.lookupEmail) loadMyRegistrations(state.lookupEmail);
}
const refreshSoon = debounce(refreshAll, 300);

function setLive(on) {
  $('#liveDot').classList.toggle('on', on);
  $('#liveText').textContent = on ? 'Live updates on' : 'Live updates off';
}

function connectLive() {
  const base = API_BASE || location.origin;
  let socket;
  try { socket = new WebSocket(base.replace(/^http/, 'ws') + '/ws'); }
  catch { setLive(false); return; }

  socket.addEventListener('open', () => setLive(true));
  socket.addEventListener('message', (msg) => {
    try { if (JSON.parse(msg.data).type === 'data_changed') refreshSoon(); } catch { /* ignore */ }
  });
  socket.addEventListener('close', () => {
    setLive(false);
    setTimeout(connectLive, 4000);
  });
}

/* ---------- Start ---------- */

renderAdminVisibility();
loadEvents();
loadHero();
loadAdminEvents();
connectLive();
