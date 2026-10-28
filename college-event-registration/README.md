# College Event Registration (CampusPass)

A beginner-friendly full-stack web app where students browse college events and register for a seat, and organizers create and manage events.

## 1. Project overview

### Features
- Browse events with **search**, **category filter** and **upcoming / past** filter
- Seat counter and progress bar on every event; "Fully booked" and "Event ended" states
- **Register** with a validated form (name, email, roll number, year, department)
- Duplicate registrations blocked (same email + same event) and **overbooking prevented** inside the database
- **My registrations**: look up by email and cancel a seat
- **Organizer area** (admin password): add, edit, delete events, see attendees, remove an attendee
- **Live updates** through WebSockets: when anyone registers, other open tabs refresh
- Loading indicators, success/error toasts, empty states, responsive layout (mobile, tablet, desktop)

### Technology stack
| Part | Technology |
|------|------------|
| Frontend | HTML, CSS, vanilla JavaScript (Fetch API) |
| Backend | Node.js, Express.js, `ws` (WebSocket) |
| Database | Supabase PostgreSQL |
| Version control | Git and GitHub |

### Folder structure
```
college-event-registration/
├── frontend/   index.html, style.css, script.js
├── backend/    server.js, supabase.js, package.json, .env.example
├── database/   schema.sql
├── .gitignore
└── README.md
```

## 2. Prerequisites and installation

1. Install **Node.js 18 or newer** (https://nodejs.org). Check with `node -v`.
2. Install **Git** (https://git-scm.com).
3. Create a free **Supabase** account (https://supabase.com).
4. Unzip the project and open a terminal in the project folder.

**Run these commands inside the `backend` directory:**

```bash
cd backend
npm install
```

`npm install` reads `package.json` and installs everything. The commands below are listed only for clarity; they are **not required** because the dependencies are already declared:

```bash
npm install express cors dotenv @supabase/supabase-js ws
npm install --save-dev nodemon
```

## 3. Supabase project and database setup

1. In Supabase click **New project**, choose a name, a database password and a region. Wait until it is ready.
2. Open **SQL Editor > New query**.
3. Open `database/schema.sql` from this project, copy everything, paste it in the editor and click **Run**.
4. Open **Table Editor**. You should see the `events` and `registrations` tables (and four sample events).

What the SQL creates: two tables with primary keys, a foreign key (registrations -> events, with cascade delete), constraints, indexes, an `updated_at` trigger, the `register_for_event` function (seat check + insert in one safe step), and Row Level Security policies.

## 4. Environment variables

1. In `backend`, copy `.env.example` to `.env`:
   - Mac/Linux: `cp .env.example .env`
   - Windows: `copy .env.example .env`
2. Fill in the values:

| Variable | Where to find it |
|----------|------------------|
| `SUPABASE_URL` | Supabase > Project Settings > API > Project URL |
| `SUPABASE_SECRET_KEY` | Same page: the **secret** key (`sb_secret_...`) or the legacy **service_role** key |
| `ADMIN_PASSWORD` | Choose your own, used on the website's Organizer area |
| `PORT` | Optional, default `5000` |
| `CLIENT_ORIGIN` | Optional, comma-separated allowed origins (empty = allow all) |

**Never put the secret key in frontend files and never upload `.env` to GitHub.** `.gitignore` already excludes it.

## 5. Start the project

```bash
cd backend
npm start        # normal start
npm run dev      # auto-restart on file changes (nodemon)
```

Open **http://localhost:5000**. The backend serves the frontend files too, so there is nothing else to start.

*(If you prefer VS Code Live Server for the frontend, it still works: `script.js` calls `http://localhost:5000` automatically when the page is not served by the backend.)*

You should see `Server running at http://localhost:5000` and `Supabase connection OK.` in the terminal.

## 6. API endpoints and testing

All responses are JSON: `{ "data": ... }` on success, `{ "error": "message", "details": [...] }` on failure.
Admin routes need the header `x-admin-key: <ADMIN_PASSWORD>`.

| Method | Endpoint | Access | Purpose |
|--------|----------|--------|---------|
| GET | `/api/health` | public | Server check |
| POST | `/api/admin/login` | admin | Verify admin password |
| GET | `/api/events?search=&category=&when=upcoming\|past\|all` | public | List events with seat counts |
| GET | `/api/events/:id` | public | One event |
| POST | `/api/events` | admin | Create event |
| PUT | `/api/events/:id` | admin | Update event |
| DELETE | `/api/events/:id` | admin | Delete event (and its registrations) |
| POST | `/api/events/:id/register` | public | Register a student |
| GET | `/api/events/:id/registrations` | admin | Attendee list |
| GET | `/api/registrations?email=` | public | Registrations of one email |
| DELETE | `/api/registrations/:id?email=` | owner or admin | Cancel registration |

### Try it from the terminal
```bash
curl http://localhost:5000/api/health
curl "http://localhost:5000/api/events?when=all"

# Create an event (replace the password and use a future date)
curl -X POST http://localhost:5000/api/events \
  -H "Content-Type: application/json" -H "x-admin-key: YOUR_ADMIN_PASSWORD" \
  -d '{"title":"Robotics Demo","venue":"Lab 3","category":"Technical","event_date":"2030-01-15T10:00:00Z","capacity":30}'

# Register (replace EVENT_ID)
curl -X POST http://localhost:5000/api/events/EVENT_ID/register \
  -H "Content-Type: application/json" \
  -d '{"student_name":"Asha Rao","email":"asha@college.edu","roll_number":"21CS042","department":"Computer Science","year":3}'
```

### Manual test checklist
- [ ] Events appear; search and filters change the list
- [ ] Register works; registering again with the same email shows an error
- [ ] Empty name / bad email show messages under the fields
- [ ] Last seat taken -> card shows "Fully booked"
- [ ] My registrations shows the seat and Cancel frees it
- [ ] Wrong admin password is rejected; correct one unlocks the area
- [ ] Add, edit, delete event and remove attendee all work
- [ ] Two browser tabs: registering in one refreshes the other

## 7. Git and GitHub submission

```bash
git init
git add .
git status            # make sure .env is NOT listed
git commit -m "College event registration project"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/college-event-registration.git
git push -u origin main
```
Create the empty repository on github.com first (no README, no .gitignore). Submit the repository link.

## 8. Common errors and troubleshooting

| Problem | Fix |
|---------|-----|
| `Missing SUPABASE_URL or SUPABASE_SECRET_KEY` | You did not create `backend/.env`, or a value is empty |
| `Missing ADMIN_PASSWORD` | Add `ADMIN_PASSWORD=...` to `.env` |
| `Could not read the "events" table` warning | Run `database/schema.sql` in the Supabase SQL Editor |
| Website says "Cannot reach the server" | Start the backend (`npm start`) and check the port |
| `EADDRINUSE` | Port 5000 is busy. Change `PORT` in `.env` (and open that port) |
| `Cannot find module 'express'` | Run `npm install` inside `backend` |
| "Invalid API key" / 401 from Supabase | Re-copy the secret key; no quotes or spaces |
| Page opened by double-clicking the file | Use http://localhost:5000 instead |
| "Live updates off" in footer | Backend not running; it reconnects automatically |

## 9. Known limitations and remaining steps

- **Admin security is basic (educational).** One shared password, checked by the backend. A real system would use Supabase Auth with individual accounts.
- **"My registrations" uses only an email.** Anyone who knows an email can see that person's registrations. Real systems verify email ownership (magic link or OTP).
- **RLS stays enabled.** Browsers can only read `events` with public keys; `registrations` is closed to them. The backend uses the secret key (which bypasses RLS) and enforces its own rules. Do not disable RLS.
- No email confirmation, payments or QR tickets.
- No rate limiting. Add `express-rate-limit` before real deployment.
- `package-lock.json` is created the first time you run `npm install`.
- Supabase credentials and the `.env` file are yours to create. The database connection was **not** tested by the author of this package (see the final message / test notes).

## 10. Short demonstration script (3 minutes)

1. Show the home page and explain the hero ticket (next event with free seats).
2. Search "git", then filter by category. Clear the filters.
3. Click **Register** on an event, submit the empty form to show validation, then fill it properly. Show the toast and the updated seat count.
4. Register again with the same email to show the duplicate error.
5. Go to **My registrations**, enter the email, cancel the seat.
6. Open **Organizer area**, enter the admin password, add an event, edit it, view attendees.
7. Open a second browser tab, register there, and show the first tab update by itself (WebSocket).
8. Show `database/schema.sql` (tables, foreign key, RLS) and `.env.example` (no secrets).

## 11. Viva questions and answers

**1. Why is the Supabase secret key kept in the backend and not in `script.js`?**
Anything in frontend files can be read by every visitor. The secret key can bypass Row Level Security, so someone could read or delete all data. The backend keeps it private in `.env`.

**2. What is Row Level Security (RLS)?**
A PostgreSQL feature that decides, row by row, who may read or write a table. Here RLS is on; public users may only read events, and nobody outside the backend can touch registrations.

**3. How does the app stop two students from taking the last seat?**
The `register_for_event` database function locks the event row, counts registrations, and inserts only if seats remain. The lock makes simultaneous requests wait their turn.

**4. What is the relationship between the two tables?**
One event has many registrations (one-to-many). `registrations.event_id` is a foreign key to `events.id`, with `ON DELETE CASCADE` so deleting an event removes its registrations.

**5. What does the Fetch API do and where is it used?**
`fetch()` sends HTTP requests from the browser. In `script.js` the `api()` helper uses it to call the Express routes (GET to read, POST to create, PUT to update, DELETE to remove) and then reads the JSON reply.
