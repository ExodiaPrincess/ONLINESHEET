/* Authentication & per-user data sync via Supabase.
 *
 *   NendysAuth         — login / logout / current user / state-change listener
 *   NendysSync         — load + save the logged-in user's prices & settings
 *
 * Everything is exposed on `window.*` so app.js (a plain non-module script)
 * can use it. Supabase JS SDK v2 is loaded as a UMD bundle in index.html. */

(function () {
  const cfg = window.NENDYS_CONFIG || {};
  const configured = cfg.SUPABASE_URL && cfg.SUPABASE_URL !== 'YOUR_SUPABASE_URL_HERE'
                  && cfg.SUPABASE_ANON_KEY && cfg.SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY_HERE';

  const supabase = configured && window.supabase
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'nendys.auth' },
      })
    : null;

  // --------------------------- AUTH ---------------------------
  window.NendysAuth = {
    /** True if config.js has real Supabase creds. */
    isConfigured: configured,

    /** Current user object (or null). */
    async getUser() {
      if (!supabase) return null;
      const { data } = await supabase.auth.getUser();
      return data?.user || null;
    },

    /** Sign in with email + password. Returns {user} on success or {error}. */
    async signIn(email, password) {
      if (!supabase) return { error: 'Auth not configured. Edit albion/config.js.' };
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) return { error: error.message };
      return { user: data.user };
    },

    async signOut() {
      if (!supabase) return;
      await supabase.auth.signOut();
    },

    /** Subscribe to auth state changes. cb(user|null). Returns unsubscribe(). */
    onChange(cb) {
      if (!supabase) { cb(null); return () => {}; }
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        cb(session?.user || null);
      });
      return () => data.subscription.unsubscribe();
    },
  };

  // --------------------------- SYNC ---------------------------
  // Stores prices + settings JSONB in public.user_data, keyed by auth.uid().
  // Reads happen once at login; writes are debounced so rapid edits don't
  // hammer the API.
  let saveTimer = null;
  const SAVE_DEBOUNCE_MS = 600;

  window.NendysSync = {
    /** Fetch the current user's row. Returns { prices, settings } or null. */
    async load() {
      if (!supabase) return null;
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) return null;
      const { data, error } = await supabase
        .from('user_data')
        .select('prices, settings')
        .eq('user_id', uid)
        .maybeSingle();
      if (error) {
        console.warn('NendysSync.load:', error.message);
        return null;
      }
      return data || { prices: {}, settings: {} };
    },

    /** Debounced upsert of the user's prices + settings. */
    save(prices, settings) {
      if (!supabase) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => this.flush(prices, settings), SAVE_DEBOUNCE_MS);
    },

    /** Force an immediate save (e.g. on logout). */
    async flush(prices, settings) {
      if (!supabase) return;
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) return;
      const { error } = await supabase.from('user_data').upsert({
        user_id: uid,
        prices: prices || {},
        settings: settings || {},
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (error) console.warn('NendysSync.flush:', error.message);
    },
  };
})();
