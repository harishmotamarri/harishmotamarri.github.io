// Supabase Client Initialization Module
// Exposes the supabase client globally to all frontend scripts

const SUPABASE_URL = 'https://ggezzqnpsyqrgwatwnfy.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_FvrId49bXNti74bhZhac5A_61_7iwR4';

if (typeof supabase === 'undefined') {
  console.error('Error: Supabase Client SDK is not loaded. Ensure the CDN script tag is present in HTML.');
}

// Global Supabase Client Instance using only the anonymous key
window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true, // Persists admin credentials locally in localStorage
    autoRefreshToken: true
  }
});
