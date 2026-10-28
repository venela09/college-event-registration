// Creates the one Supabase client used by the whole backend.
// The secret key lives ONLY here on the server, never in the frontend.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;

if (!url || !key) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SECRET_KEY.\n' +
      'Copy backend/.env.example to backend/.env and fill in your Supabase values.'
  );
  process.exit(1);
}

module.exports = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
