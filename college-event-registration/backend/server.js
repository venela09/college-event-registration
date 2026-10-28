require('dotenv').config();
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { WebSocketServer, WebSocket } = require('ws');
const supabase = require('./supabase');

const PORT = process.env.PORT || 5000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error('Missing ADMIN_PASSWORD. Add it to backend/.env (see .env.example).');
  process.exit(1);
}

const CATEGORIES = ['Technical', 'Cultural', 'Sports', 'Workshop', 'Seminar', 'Other'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ---------- Small helpers ---------- */

class HttpError extends Error {
  constructor(status, message, details = []) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Lets us use async/await in routes and send errors to the error handler
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();

function isAdmin(req) {
  const key = req.get('x-admin-key');
  return Boolean(key) && crypto.timingSafeEqual(sha(key), sha(ADMIN_PASSWORD));
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return next(new HttpError(401, 'Admin password is missing or incorrect.'));
  next();
}

function requireId(id) {
  if (!UUID_RE.test(id)) throw new HttpError(400, 'Invalid id format.');
}

// Turns a Supabase/Postgres error into a friendly HTTP error
function handleDbError(error) {
  console.error('[database error]', error);
  const msg = error.message || '';
  if (msg.includes('EVENT_FULL')) throw new HttpError(409, 'Sorry, this event is fully booked.');
  if (msg.includes('EVENT_NOT_FOUND')) throw new HttpError(404, 'Event not found.');
  if (msg.includes('EVENT_PAST'))
    throw new HttpError(400, 'Registration is closed because this event has already started.');
  if (error.code === '23505') throw new HttpError(409, 'This email is already registered for this event.');
  if (error.code === '22P02') throw new HttpError(400, 'Invalid value sent to the database.');
  if (error.code === '23514') throw new HttpError(400, 'A value breaks a database rule.');
  throw new HttpError(500, 'Database error. Please try again in a moment.');
}

// Adds "registered" and "spots_left" to an event row
function shapeEvent(row) {
  const { registrations, ...rest } = row;
  const registered = registrations?.[0]?.count ?? 0;
  return { ...rest, registered, spots_left: Math.max(0, rest.capacity - registered) };
}

/* ---------- Validation ---------- */

function validateEvent(body, { requireFuture }) {
  const errors = [];
  const data = {
    title: str(body.title),
    description: str(body.description),
    venue: str(body.venue),
    category: str(body.category) || 'Other',
  };

  if (data.title.length < 3 || data.title.length > 120)
    errors.push({ field: 'title', message: 'Title must be 3 to 120 characters.' });
  if (data.description.length > 1000)
    errors.push({ field: 'description', message: 'Description can be at most 1000 characters.' });
  if (data.venue.length < 2 || data.venue.length > 120)
    errors.push({ field: 'venue', message: 'Venue must be 2 to 120 characters.' });
  if (!CATEGORIES.includes(data.category))
    errors.push({ field: 'category', message: 'Choose a valid category.' });

  const date = new Date(body.event_date);
  if (!body.event_date || Number.isNaN(date.getTime())) {
    errors.push({ field: 'event_date', message: 'Enter a valid date and time.' });
  } else if (requireFuture && date <= new Date()) {
    errors.push({ field: 'event_date', message: 'The date must be in the future.' });
  } else {
    data.event_date = date.toISOString();
  }

  const capacity = Number(body.capacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000)
    errors.push({ field: 'capacity', message: 'Capacity must be a whole number from 1 to 10000.' });
  else data.capacity = capacity;

  if (errors.length) throw new HttpError(400, 'Please fix the highlighted fields.', errors);
  return data;
}

function validateRegistration(body) {
  const errors = [];
  const data = {
    student_name: str(body.student_name),
    email: str(body.email).toLowerCase(),
    roll_number: str(body.roll_number),
    department: str(body.department),
    year: Number(body.year),
  };

  if (data.student_name.length < 2 || data.student_name.length > 80)
    errors.push({ field: 'student_name', message: 'Name must be 2 to 80 characters.' });
  if (!EMAIL_RE.test(data.email))
    errors.push({ field: 'email', message: 'Enter a valid email address.' });
  if (data.roll_number.length < 3 || data.roll_number.length > 30)
    errors.push({ field: 'roll_number', message: 'Roll number must be 3 to 30 characters.' });
  if (data.department.length < 2 || data.department.length > 60)
    errors.push({ field: 'department', message: 'Department must be 2 to 60 characters.' });
  if (!Number.isInteger(data.year) || data.year < 1 || data.year > 4)
    errors.push({ field: 'year', message: 'Year must be 1, 2, 3 or 4.' });

  if (errors.length) throw new HttpError(400, 'Please fix the highlighted fields.', errors);
  return data;
}

/* ---------- App + WebSocket ---------- */

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Tell every open browser tab that data changed so it can refresh itself
function broadcast() {
  const message = JSON.stringify({ type: 'data_changed' });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  });
}

const origins = (process.env.CLIENT_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors({ origin: origins.length ? origins : true }));
app.use(express.json({ limit: '10kb' }));

/* ---------- Routes ---------- */

app.get('/api/health', (req, res) => res.json({ data: { status: 'ok', time: new Date().toISOString() } }));

// Check the admin password (used by the Admin login form)
app.post('/api/admin/login', requireAdmin, (req, res) => res.json({ data: { ok: true } }));

// List events. Query: search, category, when=upcoming|past|all
app.get('/api/events', wrap(async (req, res) => {
  const when = str(req.query.when) || 'upcoming';
  const category = str(req.query.category);
  const search = str(req.query.search).replace(/[^\p{L}\p{N}\s-]/gu, '').slice(0, 60);

  if (!['upcoming', 'past', 'all'].includes(when)) throw new HttpError(400, 'Invalid "when" filter.');
  if (category && category !== 'all' && !CATEGORIES.includes(category))
    throw new HttpError(400, 'Invalid category filter.');

  let query = supabase.from('events').select('*, registrations(count)').order('event_date', { ascending: true });
  const now = new Date().toISOString();
  if (when === 'upcoming') query = query.gte('event_date', now);
  if (when === 'past') query = query.lt('event_date', now);
  if (category && category !== 'all') query = query.eq('category', category);
  if (search) query = query.or(`title.ilike.%${search}%,venue.ilike.%${search}%,description.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) handleDbError(error);
  res.json({ data: data.map(shapeEvent) });
}));

// Get one event
app.get('/api/events/:id', wrap(async (req, res) => {
  requireId(req.params.id);
  const { data, error } = await supabase
    .from('events').select('*, registrations(count)').eq('id', req.params.id).maybeSingle();
  if (error) handleDbError(error);
  if (!data) throw new HttpError(404, 'Event not found.');
  res.json({ data: shapeEvent(data) });
}));

// Create event (admin)
app.post('/api/events', requireAdmin, wrap(async (req, res) => {
  const payload = validateEvent(req.body || {}, { requireFuture: true });
  const { data, error } = await supabase.from('events').insert(payload).select().single();
  if (error) handleDbError(error);
  broadcast();
  res.status(201).json({ data });
}));

// Update event (admin)
app.put('/api/events/:id', requireAdmin, wrap(async (req, res) => {
  requireId(req.params.id);
  const payload = validateEvent(req.body || {}, { requireFuture: false });

  // Capacity cannot drop below the students already registered
  const { count, error: countError } = await supabase
    .from('registrations').select('id', { count: 'exact', head: true }).eq('event_id', req.params.id);
  if (countError) handleDbError(countError);
  if (payload.capacity < count)
    throw new HttpError(409, `${count} students are already registered, so capacity cannot be lower.`, [
      { field: 'capacity', message: `Must be at least ${count}.` },
    ]);

  const { data, error } = await supabase.from('events').update(payload).eq('id', req.params.id).select().maybeSingle();
  if (error) handleDbError(error);
  if (!data) throw new HttpError(404, 'Event not found.');
  broadcast();
  res.json({ data });
}));

// Delete event (admin). Its registrations are deleted too (ON DELETE CASCADE).
app.delete('/api/events/:id', requireAdmin, wrap(async (req, res) => {
  requireId(req.params.id);
  const { data, error } = await supabase.from('events').delete().eq('id', req.params.id).select('id');
  if (error) handleDbError(error);
  if (!data || data.length === 0) throw new HttpError(404, 'Event not found.');
  broadcast();
  res.json({ data: { id: req.params.id, deleted: true } });
}));

// Register a student for an event
app.post('/api/events/:id/register', wrap(async (req, res) => {
  requireId(req.params.id);
  const v = validateRegistration(req.body || {});
  const { data, error } = await supabase.rpc('register_for_event', {
    p_event_id: req.params.id,
    p_name: v.student_name,
    p_email: v.email,
    p_roll: v.roll_number,
    p_dept: v.department,
    p_year: v.year,
  });
  if (error) handleDbError(error);
  broadcast();
  res.status(201).json({ data });
}));

// List attendees of one event (admin)
app.get('/api/events/:id/registrations', requireAdmin, wrap(async (req, res) => {
  requireId(req.params.id);
  const { data, error } = await supabase
    .from('registrations').select('*').eq('event_id', req.params.id).order('created_at', { ascending: true });
  if (error) handleDbError(error);
  res.json({ data });
}));

// "My registrations": look up by email
app.get('/api/registrations', wrap(async (req, res) => {
  const email = str(req.query.email).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.', [{ field: 'email', message: 'Enter a valid email address.' }]);
  const { data, error } = await supabase
    .from('registrations')
    .select('*, events(id, title, venue, event_date, category)')
    .eq('email', email)
    .order('created_at', { ascending: false });
  if (error) handleDbError(error);
  res.json({ data });
}));

// Cancel a registration. The student passes ?email=... that must match, or the admin key is sent.
app.delete('/api/registrations/:id', wrap(async (req, res) => {
  requireId(req.params.id);
  const { data: existing, error: findError } = await supabase
    .from('registrations').select('id, email').eq('id', req.params.id).maybeSingle();
  if (findError) handleDbError(findError);
  if (!existing) throw new HttpError(404, 'Registration not found.');

  const email = str(req.query.email).toLowerCase();
  if (!isAdmin(req) && email !== existing.email)
    throw new HttpError(403, 'You can only cancel your own registration.');

  const { error } = await supabase.from('registrations').delete().eq('id', req.params.id);
  if (error) handleDbError(error);
  broadcast();
  res.json({ data: { id: req.params.id, deleted: true } });
}));

/* ---------- Frontend files, 404 and errors ---------- */

// The backend also serves the frontend, so http://localhost:5000 shows the website
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
  console.error('[server error]', err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

server.listen(PORT, async () => {
  console.log(`Server running at http://localhost:${PORT}`);
  // Friendly startup check so setup problems show up immediately
  const { error } = await supabase.from('events').select('id', { head: true, count: 'exact' });
  if (error) console.warn('WARNING: Could not read the "events" table. Did you run database/schema.sql? ->', error.message);
  else console.log('Supabase connection OK.');
});
