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

  // --------------------------- RECIPE DATA ---------------------------
  // The recipe JSON (data.json, icons.json) lives in the PRIVATE Supabase
  // Storage bucket `recipe-data`, readable only by authenticated users (a
  // storage RLS policy grants SELECT to the `authenticated` role only). The
  // files are no longer served as public static assets, so an anonymous
  // visitor cannot download the dataset.
  //
  // Each file is cached client-side keyed by its storage version (`updated_at`)
  // via the Cache API, so returning users don't re-download the multi-MB
  // data.json on every visit — and we don't burn Supabase egress.
  const RECIPE_BUCKET = 'recipe-data';
  const RECIPE_CACHE  = 'nendys.recipe-data';

  // One list() per page session yields every file's version; memoised.
  let versionsPromise = null;
  function recipeVersions() {
    if (!versionsPromise) {
      versionsPromise = (async () => {
        const { data, error } = await supabase.storage.from(RECIPE_BUCKET).list('', { limit: 100 });
        if (error) throw new Error(error.message);
        const map = {};
        for (const o of data || []) map[o.name] = o.updated_at || o.id || '';
        return map;
      })();
    }
    return versionsPromise;
  }

  window.NendysData = {
    /** Download + parse a JSON file from the private bucket, using a
     *  version-keyed Cache API entry so unchanged files aren't re-downloaded.
     *  Throws if not configured / not authenticated / RLS denies access. */
    async loadJSON(name) {
      if (!supabase) throw new Error('Auth not configured. Edit albion/config.js.');
      const versions = await recipeVersions();
      const version  = versions[name] || '';
      const canCache = 'caches' in window && !!version;
      const key = `${location.origin}/__recipe/${name}?v=${encodeURIComponent(version)}`;

      if (canCache) {
        const cache = await caches.open(RECIPE_CACHE);
        const hit = await cache.match(key);
        if (hit) return JSON.parse(await hit.text());
      }

      const { data, error } = await supabase.storage.from(RECIPE_BUCKET).download(name);
      if (error) throw new Error(error.message);
      const text = await data.text();

      if (canCache) {
        const cache = await caches.open(RECIPE_CACHE);
        // Evict older versions of this file before storing the fresh one.
        for (const req of await cache.keys()) {
          if (req.url.includes(`/__recipe/${name}?v=`)) await cache.delete(req);
        }
        await cache.put(key, new Response(text, { headers: { 'Content-Type': 'application/json' } }));
      }
      return JSON.parse(text);
    },
  };
})();
