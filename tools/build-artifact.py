"""Build a single-file copy of Wok & Cart for the Claude artifact.
Usage: python3 tools/build-artifact.py OUT.html
Same styles, recipes and app code as the installed app; storage uses the
artifact's own per-user database instead of Supabase."""
import re, sys, pathlib
R = pathlib.Path(__file__).resolve().parent.parent
html = (R/"index.html").read_text()
css = (R/"styles.css").read_text()
recipes = (R/"recipes.js").read_text()
app = (R/"app.js").read_text()
ver = re.search(r'APP_VERSION = "([\d.]+)"', (R/"account.js").read_text()).group(1)
body = html[html.index("<body>")+6 : html.index('<script src="config.js">')]
fonts = re.search(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]+>', html).group(0)

shim = r'''
/* Artifact storage: the signed-in viewer's private row in this artifact's database. */
window.Sync = (function () {
  let ref = null, timer = null, get = () => ({}), set = () => {}, status = () => {};
  const say = (kind, text) => status({ kind, text });
  async function push() {
    if (!ref) return;
    try { await ref.set(JSON.parse(JSON.stringify(get()))); say("ok", "Synced to your Claude account"); }
    catch (e) { say("error", "Couldn't sync. Saved in this browser."); }
  }
  async function connect() {
    if (!window.claude || !claude.use) { say("local", "Saved in this browser"); return; }
    try {
      const [db, user] = await Promise.all([claude.use("db"), claude.use("user")]);
      if (!db || !user) { say("local", "Saved in this browser"); return; }
      const uid = await user.id(); if (!uid) { say("local", "Saved in this browser"); return; }
      ref = db.doc("data/users/" + uid + "/planner");
      const snap = await ref.get();
      if (snap.exists) set(JSON.parse(JSON.stringify(snap.data())), false);
      else await push();
      say("ok", "Synced to your Claude account");
    } catch (e) { say("local", "Saved in this browser"); }
  }
  return {
    configured: () => false, email: null, lastError: null, _merge: (a, b) => Object.assign({}, a, b),
    init(o) { get = o.getState; set = o.setState; status = o.onStatus || status; say("local", "Saved in this browser"); connect(); },
    changed() { if (!ref) return; say("pending", "Saving…"); clearTimeout(timer); timer = setTimeout(push, 700); },
    now: push
  };
})();
'''
about = r'''
document.getElementById("sync").onclick = () => openSheet(`
  <div class="sheet-head"><div><span class="label">About</span><h3>Wok &amp; Cart</h3></div><button class="x" data-close aria-label="Close">✕</button></div>
  <p class="blurb">This copy lives in Claude and saves to your Claude account. The installed phone app keeps its own list and log, synced through its own sign-in.</p>
  <p class="blurb" style="margin-top:10px">Install the app: <b>2hk9sdj886-a11y.github.io/wok-and-cart</b></p>
  <p class="fine">Version __VER__</p>`);
'''.replace("__VER__", ver)

out = f'''<title>Wok &amp; Cart</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
{fonts}
<style>
{css}
/* artifact frame already pads the top safe area: header sticks below it, band paints it */
.wrap{{padding-top:0}}
header.top{{padding-top:16px}}
body::before{{z-index:10;background:var(--bg)}}
</style>
{body}
<script>
{recipes}
{shim}
{app}
{about}
</script>
'''
pathlib.Path(sys.argv[1]).write_text(out)
print("built", sys.argv[1], len(out), "bytes, version", ver)
