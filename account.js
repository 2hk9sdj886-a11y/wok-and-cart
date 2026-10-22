/* Account & sync sheet, backups, install prompt, service worker. */
(function () {
  const APP_VERSION = "1.1.0";

  function accountSheet() {
    const signedIn = !!Sync.email;
    let body;
    if (!Sync.configured()) {
      body = `<p class="blurb">Sync isn't set up yet. Everything is saved on this device. Add your Supabase URL and key to <code>config.js</code> to sync between devices.</p>`;
    } else if (signedIn) {
      body = `
        <p class="blurb">Signed in as <b>${esc(Sync.email)}</b>. Your list, log and settings sync to every device signed in to this account.</p>
        <p class="acct-status" id="acctStatus">${esc(syncState.text)}</p>
        ${Sync.lastError ? `<div class="sync-err"><b>What went wrong</b><p>${esc(Sync.lastError.hint || "Supabase returned an error.")}</p><code>${esc(Sync.lastError.raw)}</code></div>` : ""}
        <div class="actions"><button class="btn primary" id="syncNow">Sync now</button><button class="btn warn" id="signOut">Sign out</button></div>`;
    } else {
      body = `
        <p class="blurb">Sign in to sync your list and calorie log between your phone and computer. Your data stays on this device until you do.</p>
        <form id="signin" class="signin" novalidate>
          <label class="label" for="em">Email</label>
          <input class="field" id="em" type="email" autocomplete="username" inputmode="email" required>
          <label class="label" for="pw">Password</label>
          <input class="field" id="pw" type="password" autocomplete="current-password" required>
          <p class="err" id="signErr" hidden></p>
          <div class="actions"><button class="btn primary" id="signBtn">Sign in</button></div>
        </form>`;
    }
    openSheet(`
      <div class="sheet-head"><div><span class="label">Account</span><h3>Sync & backup</h3></div>
        <button class="x" data-close aria-label="Close">✕</button></div>
      ${body}
      <hr class="rule">
      <span class="label">Backup</span>
      <p class="blurb">Copy everything as text to keep somewhere safe, or paste a backup to restore it.</p>
      <div class="actions"><button class="btn" id="bkCopy">Copy backup</button><button class="btn" id="bkShow">Restore from backup</button></div>
      <div id="bkArea" hidden>
        <textarea class="field bk" id="bkText" rows="5" aria-label="Backup text" placeholder="Paste backup text here"></textarea>
        <div class="actions"><button class="btn primary" id="bkLoad">Restore</button></div>
      </div>
      <p class="fine">Version ${APP_VERSION}</p>`);

    const f = document.getElementById("signin");
    if (f) f.onsubmit = async e => {
      e.preventDefault();
      const err = document.getElementById("signErr"), btn = document.getElementById("signBtn");
      const em = document.getElementById("em").value.trim(), pw = document.getElementById("pw").value;
      if (!em || !pw) { err.textContent = "Enter your email and password."; err.hidden = false; return; }
      btn.disabled = true; btn.textContent = "Signing in…"; err.hidden = true;
      try { await Sync.signIn(em, pw); toast("Signed in"); accountSheet(); }
      catch (x) {
        err.textContent = /invalid/i.test(x.message) ? "That email and password don't match. Check them and try again." : (navigator.onLine ? x.message : "You're offline. Connect to sign in.");
        err.hidden = false; btn.disabled = false; btn.textContent = "Sign in";
      }
    };
    const sn = document.getElementById("syncNow"); if (sn) sn.onclick = async () => { sn.disabled = true; sn.textContent = "Syncing…"; await Sync.now(); accountSheet(); };
    const so = document.getElementById("signOut"); if (so) so.onclick = async () => { await Sync.signOut(); accountSheet(); };

    document.getElementById("bkCopy").onclick = async () => {
      const txt = JSON.stringify(S);
      try { await navigator.clipboard.writeText(txt); toast("Backup copied"); }
      catch (e) {
        document.getElementById("bkArea").hidden = false;
        const t = document.getElementById("bkText"); t.value = txt; t.select();
        toast("Select all and copy");
      }
    };
    document.getElementById("bkShow").onclick = () => { document.getElementById("bkArea").hidden = false; document.getElementById("bkText").focus(); };
    document.getElementById("bkLoad").onclick = () => {
      try {
        const d = JSON.parse(document.getElementById("bkText").value);
        if (!d || typeof d !== "object" || !("list" in d || "log" in d)) throw 0;
        const merged = Sync._merge(S, d);
        S = Object.assign(blank(), merged); fixOrder(); save(); renderAll(); closeSheet();
        toast("Backup restored");
      } catch (e) { toast("That text isn't a Wok & Cart backup"); }
    };
  }
  document.getElementById("sync").onclick = accountSheet;

  /* ---------- install hint ---------- */
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const hint = document.getElementById("installHint");
  let dismissed = false;
  try { dismissed = localStorage.getItem("wok-cart-hint") === "1"; } catch (e) {}
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  function showHint(html) {
    if (standalone || dismissed) return;
    hint.innerHTML = `<div>${html}</div><button class="x" id="hintX" aria-label="Dismiss">✕</button>`;
    hint.hidden = false;
    document.getElementById("hintX").onclick = () => { hint.hidden = true; try { localStorage.setItem("wok-cart-hint", "1"); } catch (e) {} };
  }
  if (isIOS) showHint(`<b>Install on your iPhone:</b> tap the Share button, then <em>Add to Home Screen</em>.`);
  let deferred = null;
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault(); deferred = e;
    showHint(`<b>Install Wok & Cart</b> for one-tap access and offline use in the store. <button class="btn primary" id="doInstall" style="margin-left:6px">Install</button>`);
    const b = document.getElementById("doInstall");
    if (b) b.onclick = async () => { deferred.prompt(); await deferred.userChoice; hint.hidden = true; };
  });

  /* ---------- offline support ---------- */
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(e => console.warn("SW", e));
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
})();
