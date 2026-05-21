/* =====================================================
   supabase-client.js — Supabase client singleton
   Initialised from AppConfig (config.js).
   All other modules import `SupabaseClient`.
   ===================================================== */

const SupabaseClient = (() => {
  let _client = null;
  let _ready = false;
  let _initError = null;

  function init() {
    if (_client) return _client;
    try {
      if (!window.supabase || !window.supabase.createClient) {
        throw new Error('Supabase JS library not loaded');
      }
      _client = window.supabase.createClient(
        AppConfig.SUPABASE_URL,
        AppConfig.SUPABASE_ANON_KEY,
        {
          auth: { persistSession: false },  // no login — personal app
          realtime: { enabled: false }       // not needed
        }
      );
      _ready = true;
      console.info('[Supabase] Client initialized');
    } catch (err) {
      _initError = err;
      console.warn('[Supabase] Init failed:', err.message);
    }
    return _client;
  }

  function get() { return _client; }
  function isReady() { return _ready && !!_client; }
  function getError() { return _initError; }

  // Convenience: get persistent user_id (UUID stored in localStorage)
  function getUserId() {
    const key = 'vrshoot.user_id';
    let uid = localStorage.getItem(key);
    if (!uid) {
      uid = crypto.randomUUID
        ? crypto.randomUUID()
        : 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
      localStorage.setItem(key, uid);
    }
    return uid;
  }

  return { init, get, isReady, getError, getUserId };
})();
