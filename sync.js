/* Wok & Cart sync: talks to Supabase's REST API directly (no SDK).
 *
 * Model: one row per user in public.planner_state { user_id, data jsonb, rev bigint }.
 * The app is local-first. Every edit is saved to localStorage and marked dirty.
 * When online and signed in, dirty state is pushed. If another device changed the
 * row since our last sync, the two copies are merged first (union of list items
 * and log entries by id, deletions honored through tombstones, local settings win).
 */
(function () {
  const CFG = window.WOK_CONFIG || {};
  const BASE = (CFG.supabaseUrl || "").replace(/\/+$/, "");
  const KEY = CFG.supabaseKey || "";
  const SESSION_KEY = "wok-cart-session";
  const META_KEY = "wok-cart-meta";

  const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  let session = read(SESSION_KEY, null);       // {access_token, refresh_token, expires_at, user:{id,email}}
  let meta = read(META_KEY, { baseRev: null, dirty: false });
  let getState = () => ({}), setState = () => {}, onStatus = () => {};
  let busy = false, again = false, timer = null, poll = null, wired = false;
  let lastError = null;

  function explain(e) {
    const raw = String((e && e.message) || e);
    let hint = "";
    if (/PGRST205|PGRST202|does not exist|schema cache|404/.test(raw)) hint = "The planner_state table wasn't found. Run supabase/schema.sql in Supabase's SQL Editor, and check that the Data API is enabled.";
    else if (/42501|permission denied|row-level security|403/.test(raw)) hint = "Database permissions blocked the save. Re-run supabase/schema.sql (the policy and grant lines).";
    else if (/401|JWT|jwt/.test(raw)) hint = "Your sign-in wasn't accepted by the database. Sign out and sign in again.";
    else if (/Failed to fetch|NetworkError|Load failed/.test(raw)) hint = "Couldn't reach Supabase. Check your connection.";
    return { hint, raw: raw.slice(0, 400) };
  }

  const configured = () => !!(BASE && KEY);
  const saveMeta = () => write(META_KEY, meta);
  function status(kind, text) { onStatus({ kind, text, email: session && session.user && session.user.email }); }

  /* ---------- auth ---------- */
  async function authCall(path, body) {
    const r = await fetch(BASE + "/auth/v1/" + path, {
      method: "POST",
      headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j.error_description || j.msg || j.message || ("Sign-in failed (" + r.status + ")");
      const err = new Error(msg); err.status = r.status; throw err;
    }
    return j;
  }
  function keep(j) {
    session = {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
      user: { id: j.user.id, email: j.user.email }
    };
    write(SESSION_KEY, session);
  }
  async function token() {
    if (!session) throw Object.assign(new Error("Signed out"), { status: 401 });
    if (session.expires_at - 60 < Date.now() / 1000) {
      try { keep(await authCall("token?grant_type=refresh_token", { refresh_token: session.refresh_token })); }
      catch (e) {
        if (e.status && e.status < 500) { signOutLocal(); status("signedout", "Signed out. Sign in again to sync."); }
        throw e;
      }
    }
    return session.access_token;
  }

  /* ---------- REST ---------- */
  async function rest(method, query, body, retried) {
    const t = await token();
    const headers = { apikey: KEY, Authorization: "Bearer " + t, "Content-Type": "application/json" };
    if (method === "POST") headers.Prefer = "resolution=merge-duplicates,return=minimal";
    const r = await fetch(BASE + "/rest/v1/planner_state" + query, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401 && !retried) { session.expires_at = 0; return rest(method, query, body, true); }
    if (!r.ok) { const e = new Error("Sync error " + r.status + " " + (await r.text().catch(() => ""))); e.status = r.status; throw e; }
    return method === "GET" ? r.json() : null;
  }
  async function fetchRemote() {
    const rows = await rest("GET", "?select=data,rev&user_id=eq." + encodeURIComponent(session.user.id));
    return rows && rows[0] ? rows[0] : null;
  }

  /* ---------- merge ---------- */
  function merge(local, remote) {
    const out = JSON.parse(JSON.stringify(remote || {}));
    Object.assign(out, {
      target: local.target, order: local.order, aisles: local.aisles, storeV: local.storeV
    });
    const gone = Object.assign({}, remote.gone || {}, local.gone || {});
    const byId = new Map();
    for (const i of remote.list || []) byId.set(i.id, i);
    for (const i of local.list || []) byId.set(i.id, i);
    out.list = [...byId.values()].filter(i => !gone[i.id]);
    out.log = {};
    const days = new Set([...Object.keys(remote.log || {}), ...Object.keys(local.log || {})]);
    for (const d of days) {
      const m = new Map();
      for (const e of (remote.log || {})[d] || []) m.set(e.id, e);
      for (const e of (local.log || {})[d] || []) m.set(e.id, e);
      const arr = [...m.values()].filter(e => !gone[e.id]);
      if (arr.length) out.log[d] = arr;
    }
    out.onList = Object.assign({}, remote.onList || {}, local.onList || {});
    if (!out.list.length) out.onList = {};
    out.gone = pruneGone(gone);
    return out;
  }
  function pruneGone(g) {
    const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 60; // keep 60 days of tombstones
    const o = {};
    for (const [k, t] of Object.entries(g || {})) if (t > cutoff) o[k] = t;
    return o;
  }

  /* ---------- sync loop ---------- */
  async function run() {
    if (!configured() || !session) return;
    if (!navigator.onLine) { status("offline", meta.dirty ? "Offline. Changes will sync later." : "Offline"); return; }
    if (busy) { again = true; return; }
    busy = true; again = false;
    let pushing = false;
    try {
      status("syncing", "Syncing…");
      const remote = await fetchRemote();
      if (meta.dirty) {
        let s = getState();
        if (remote && remote.rev !== meta.baseRev) { s = merge(s, remote.data || {}); }
        s.rev = Math.max(Date.now(), remote ? remote.rev + 1 : 0);
        s.gone = pruneGone(s.gone);
        meta.dirty = false; saveMeta();          // edits made during the upload set it again
        pushing = true;
        await rest("POST", "", { user_id: session.user.id, data: s, rev: s.rev, updated_at: new Date().toISOString() });
        pushing = false;
        meta.baseRev = s.rev; saveMeta();
        // fold the uploaded copy back in without dropping anything edited during the upload
        const merged = merge(getState(), s); merged.rev = s.rev;
        setState(merged, false);
      } else if (remote && remote.rev !== meta.baseRev) {
        meta.baseRev = remote.rev; saveMeta();
        setState(remote.data || {}, true);
      } else if (!remote) {
        meta.dirty = true; saveMeta(); again = true;   // first sign-in on an empty account: upload this device
      }
      lastError = null;
      status("ok", "Synced");
    } catch (e) {
      if (pushing) { meta.dirty = true; saveMeta(); }
      lastError = explain(e);
      if (session) status("error", navigator.onLine ? "Couldn't sync. Tap for details." : "Offline");
      console.warn("[sync]", e);
    } finally {
      busy = false;
      if (again) setTimeout(run, 300);
    }
  }

  function signOutLocal() { session = null; write(SESSION_KEY, null); meta.baseRev = null; saveMeta(); }

  window.Sync = {
    configured,
    get email() { return session && session.user && session.user.email; },
    get lastError() { return lastError; },
    init(opts) {
      getState = opts.getState; setState = opts.setState; onStatus = opts.onStatus || onStatus;
      if (!configured()) { status("local", "Saved on this phone"); return; }
      if (!session) { status("signedout", "Not signed in. Saved on this device."); return; }
      run();
      if (wired) return;
      wired = true;
      window.addEventListener("online", run);
      window.addEventListener("offline", () => status("offline", "Offline"));
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") run(); });
      clearInterval(poll); poll = setInterval(() => { if (document.visibilityState === "visible" && !meta.dirty) run(); }, 20000);
    },
    changed() {
      meta.dirty = true; saveMeta();
      if (!configured() || !session) return;
      status("pending", "Saving…");
      clearTimeout(timer); timer = setTimeout(run, 800);
    },
    now: run,
    async signIn(email, password) {
      keep(await authCall("token?grant_type=password", { email, password }));
      meta.baseRev = null; meta.dirty = true; saveMeta();   // merge this device into the account on first sync
      this.init({ getState, setState, onStatus });
    },
    async signOut() {
      try { if (session) await fetch(BASE + "/auth/v1/logout", { method: "POST", headers: { apikey: KEY, Authorization: "Bearer " + session.access_token } }); } catch (e) {}
      signOutLocal(); clearInterval(poll);
      status("signedout", "Signed out. Saved on this device.");
    },
    _merge: merge
  };
})();
