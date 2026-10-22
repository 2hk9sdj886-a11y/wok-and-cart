/* ---------- State & persistence ---------- */
const LS_KEY = "wok-cart-v1";
const blank = () => ({ list:[], log:{}, target:2000, order:DEFAULT_ORDER.slice(), aisles:{}, onList:{} });
let S = blank();
try { const raw = localStorage.getItem(LS_KEY); if (raw) S = Object.assign(blank(), JSON.parse(raw)); } catch(e) {}
fixOrder();

function fixOrder(){
  S.gone = S.gone || {};
  for (const i of S.list) if (!SECTIONS[i.sec]) i.sec = STORE_SEC[i.name] || OLD_SEC[i.sec] || "other";
  for (const k of Object.keys(S.aisles)) if (!SECTIONS[k]) delete S.aisles[k];
  if (!S.storeV) { S.order = DEFAULT_ORDER.slice(); S.storeV = 708; }
  const seen = new Set(S.order.filter(k => SECTIONS[k]));
  S.order = [...seen, ...DEFAULT_ORDER.filter(k => !seen.has(k))];
}
let syncState = { kind:"local", text:"Saved on this phone" };
function setSync(st){
  syncState = st;
  const el = document.getElementById("sync");
  el.textContent = st.text;
  el.dataset.kind = st.kind;
  if (document.getElementById("acctStatus")) document.getElementById("acctStatus").textContent = st.text;
}
function persist(){ try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch(e) {} }
function save(){ persist(); if (window.Sync) Sync.changed(); }
function bury(ids){ const t = Date.now(); for (const id of ids) S.gone[id] = t; }

/* ---------- Helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const dkey = d => { const x = new Date(d); return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0"); };
const todayKey = () => dkey(new Date());
const parseKey = k => { const [y,m,d] = k.split("-").map(Number); return new Date(y, m-1, d); };
const uid = () => Math.random().toString(36).slice(2, 10);
const fmt = n => n.toLocaleString("en-US");
function fmtQty(q){
  const whole = Math.floor(q + 1e-9), frac = q - whole;
  const fr = [[0,""],[0.25,"¼"],[0.33,"⅓"],[0.5,"½"],[0.67,"⅔"],[0.75,"¾"],[1,""]];
  let best = fr[0]; for (const f of fr) if (Math.abs(frac - f[0]) < Math.abs(frac - best[0])) best = f;
  if (best[0] === 1) return String(whole + 1);
  if (Math.abs(frac - best[0]) > 0.09) return (Math.round(q*10)/10).toString();
  return (whole ? whole : "") + best[1] || "0";
}
function dayTotal(k){ return (S.log[k]||[]).reduce((a,e) => a + Math.round(e.kcal * e.servings), 0); }
function toast(msg){
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2200);
}

/* ---------- Actions ---------- */
function addRecipeToList(r, servings){
  const scale = servings / r.serves;
  for (const [name, qty, unit, sec, pantry] of r.ing) {
    let item = S.list.find(i => i.name === name && i.unit === unit);
    const add = Math.round(qty * scale * 100) / 100;
    if (item) { item.qty = Math.round((item.qty + add) * 100) / 100; if (!item.meals.includes(r.name)) item.meals.push(r.name); item.checked = false; }
    else S.list.push({ id:uid(), name, qty:add, unit, sec, pantry:!!pantry, checked:false, meals:[r.name] });
  }
  S.onList[r.id] = (S.onList[r.id] || 0) + servings;
  save(); renderAll();
  toast(r.ing.length + " ingredients added to your list");
}
function logMeal(name, kcal, servings, dateK, mealId){
  (S.log[dateK] = S.log[dateK] || []).push({ id:uid(), name, kcal, servings, mealId: mealId || null });
  save(); renderAll();
}

/* ---------- Meals view ---------- */
let mealFilter = "all";
function renderMeals(){
  const list = RECIPES.filter(r => mealFilter === "all" ? true : mealFilter === "light" ? r.kcal < 520 : r.cat === mealFilter)
    .slice().sort((a,b) => mealFilter === "light" ? a.kcal - b.kcal : 0);
  const heat = h => h ? `<span class="tag heat">${["","Mild heat","Medium heat","Spicy"][h]}</span>` : "";
  $("#v-meals").innerHTML = `
    <h2 class="sec">What's for dinner?</h2>
    <p class="lede">Pick a meal, send its ingredients to your HEB list, and log it when you cook. Calories are per serving.</p>
    <div class="chips" role="group" aria-label="Filter meals">
      ${CATS.map(([k,l]) => `<button class="chip" data-f="${k}" aria-pressed="${mealFilter===k}">${l}</button>`).join("")}
    </div>
    <div class="meals">
      ${list.map(r => `
        <article class="meal">
          <div class="meal-top">
            <h3>${esc(r.name)}</h3>
            <div class="kcal"><b>${r.kcal}</b><small>kcal/serving</small></div>
          </div>
          <div class="meta">
            <span class="tag">${r.mins} min</span><span class="tag">Serves ${r.serves}</span>${heat(r.heat)}
            ${S.onList[r.id] ? `<span class="tag on">On list</span>` : ""}
          </div>
          <p class="blurb">${esc(r.blurb)}</p>
          <div class="actions">
            <button class="btn" data-open="${r.id}">Recipe</button>
            <button class="btn" data-add="${r.id}">Add to list</button>
            <button class="btn primary" data-cook="${r.id}">Cooked it</button>
          </div>
        </article>`).join("")}
    </div>
    <p class="fine">Calorie counts are estimates for one serving with ¾ cup cooked rice or 2 oz dry pasta where included. Brands and portions change the real number.</p>`;
}

function openSheet(html){
  const root = $("#sheetRoot");
  root.innerHTML = `<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  $("#scrim").addEventListener("click", e => { if (e.target.id === "scrim" || e.target.closest("[data-close]")) closeSheet(); });
  const f = root.querySelector("button,input"); if (f) f.focus();
}
function closeSheet(){ $("#sheetRoot").innerHTML = ""; }
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });

function recipeSheet(r){
  let sv = r.serves;
  const draw = () => {
    const sc = sv / r.serves;
    openSheet(`
      <div class="sheet-head"><div><span class="label">${CATS.find(c=>c[0]===r.cat)[1]} · ${r.mins} min</span><h3>${esc(r.name)}</h3></div>
        <button class="x" data-close aria-label="Close">✕</button></div>
      <p class="blurb">${esc(r.blurb)}</p>
      <div class="split" style="margin:14px 0 4px">
        <div class="row"><span class="label">Servings</span>
          <div class="stepper"><button id="svm" aria-label="Fewer servings">−</button><output>${sv}</output><button id="svp" aria-label="More servings">+</button></div></div>
        <div class="kcal"><b>${r.kcal}</b><small>kcal per serving</small></div>
      </div>
      <span class="label">Ingredients</span>
      <ul class="ing">${r.ing.map(([n,q,u,s,p]) => `<li class="${p?"staple":""}"><span>${esc(n)}</span><span>${fmtQty(q*sc)} ${esc(u)}</span></li>`).join("")}</ul>
      <span class="label">Steps</span>
      <ol class="steps">${r.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol>
      <div class="actions">
        <button class="btn" id="sAdd">Add ${sv} servings to list</button>
        <button class="btn primary" id="sCook">Cooked it</button>
      </div>`);
    $("#svm").onclick = () => { if (sv > 1) { sv--; draw(); } };
    $("#svp").onclick = () => { if (sv < 12) { sv++; draw(); } };
    $("#sAdd").onclick = () => { addRecipeToList(r, sv); closeSheet(); };
    $("#sCook").onclick = () => cookSheet(r);
  };
  draw();
}

function cookSheet(r){
  let sv = 1;
  const draw = () => {
    openSheet(`
      <div class="sheet-head"><div><span class="label">Log a meal</span><h3>${esc(r.name)}</h3></div>
        <button class="x" data-close aria-label="Close">✕</button></div>
      <p class="blurb">How much did you eat?</p>
      <div class="split" style="margin:14px 0">
        <div class="stepper"><button id="cm" aria-label="Less">−</button><output>${fmtQty(sv)}</output><button id="cp" aria-label="More">+</button></div>
        <div class="kcal"><b>${fmt(Math.round(r.kcal*sv))}</b><small>kcal</small></div>
      </div>
      <label class="label" for="cDate">Date</label>
      <div class="row" style="margin:6px 0 16px"><input class="field" type="date" id="cDate" value="${todayKey()}" max="${todayKey()}"></div>
      <div class="actions"><button class="btn primary" id="cGo">Log ${fmt(Math.round(r.kcal*sv))} kcal</button><button class="btn ghost" data-close>Cancel</button></div>`);
    $("#cm").onclick = () => { if (sv > 0.5) { sv -= 0.5; draw(); } };
    $("#cp").onclick = () => { if (sv < 4) { sv += 0.5; draw(); } };
    $("#cGo").onclick = () => {
      const d = $("#cDate").value || todayKey();
      logMeal(r.name, r.kcal, sv, d, r.id); closeSheet();
      toast("Logged " + fmt(Math.round(r.kcal*sv)) + " kcal" + (d === todayKey() ? " for today" : " for " + parseKey(d).toLocaleDateString("en-US",{month:"short",day:"numeric"})));
    };
  };
  draw();
}

$("#v-meals").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.f) { mealFilter = b.dataset.f; renderMeals(); }
  else if (b.dataset.open) recipeSheet(recipeById(b.dataset.open));
  else if (b.dataset.add) { const r = recipeById(b.dataset.add); addRecipeToList(r, r.serves); }
  else if (b.dataset.cook) cookSheet(recipeById(b.dataset.cook));
});

/* ---------- Grocery view ---------- */
let hidePantry = false;
function renderList(){
  const items = S.list;
  const done = items.filter(i => i.checked).length;
  const meals = Object.keys(S.onList).map(recipeById).filter(Boolean);
  let html = `
    <div class="split"><h2 class="sec">HEB list</h2><span class="label">${done} of ${items.length} in cart</span></div>
    <div class="progress"><i style="width:${items.length ? done/items.length*100 : 0}%"></i></div>
    <form class="add-form" id="addForm">
      <input id="addName" placeholder="Add an item (e.g. sparkling water)" aria-label="Item name" autocomplete="off">
      <select id="addSec" aria-label="Section">${S.order.map(k => `<option value="${k}">${SECTIONS[k]}</option>`).join("")}</select>
      <button class="btn primary">Add</button>
    </form>
    ${items.some(i => !i.checked) ? `<div class="toolbar">
      <button class="btn primary" id="curbside">Order curbside on H-E-B</button>
      <button class="btn" id="copyList">Copy list</button>
    </div>` : ""}
    <div class="toolbar">
      <button class="btn" id="tgPantry" aria-pressed="${hidePantry}">${hidePantry ? "Show" : "Hide"} pantry staples</button>
      <button class="btn" id="editOrder">Store order & aisles</button>
      ${done ? `<button class="btn" id="clearDone">Clear checked</button>` : ""}
      ${items.length ? `<button class="btn warn" id="clearAll">Start new list</button>` : ""}
    </div>`;
  if (meals.length) html += `<p class="lede" style="margin-top:-4px">For: ${meals.map(m => esc(m.name)).join(" · ")}</p>`;
  if (!items.length) {
    html += `<div class="empty"><b>Your list is empty</b>Open Meals and tap <em>Add to list</em> on a dinner. Ingredients land here grouped in the order you walk the store.</div>`;
  } else {
    let stop = 0;
    for (const sec of S.order) {
      const rows = items.filter(i => i.sec === sec && !(hidePantry && i.pantry))
        .sort((a,b) => (a.checked - b.checked) || a.name.localeCompare(b.name));
      if (!rows.length) continue;
      stop++;
      html += `<div class="aisle">
        <div class="aisle-head"><span class="stop">${String(stop).padStart(2,"0")}</span><h4>${SECTIONS[sec]}</h4>${(S.aisles[sec]||AISLE_NO[sec]) ? `<span class="aisle-no">Aisle ${esc(S.aisles[sec]||AISLE_NO[sec])}</span>` : ""}</div>
        ${rows.map(i => `<label class="item ${i.checked?"done":""}">
            <input type="checkbox" data-chk="${i.id}" ${i.checked?"checked":""}>
            <span class="nm">${esc(i.name)} ${i.pantry ? `<span class="pantry-flag">check pantry</span>` : ""}${i.meals && i.meals.length ? `<small>${esc(i.meals.join(", "))}</small>` : ""}</span>
            <span class="q">${i.qty ? fmtQty(i.qty) + " " + esc(i.unit||"") : ""}</span>
            <button class="rm" type="button" data-rm="${i.id}" aria-label="Remove ${esc(i.name)}">✕</button>
          </label>`).join("")}
      </div>`;
    }
  }
  html += `<p class="fine">Aisles follow the Wimberley H-E-B store guide. The route runs produce, deli, aisles 1 through 11, then meat, dairy and frozen last so cold items spend the least time in the cart. Tap <em>Store order & aisles</em> if your usual path differs. Texas grocery stores don’t sell liquor, so vodka is a liquor-store stop.</p>`;
  $("#v-list").innerHTML = html;

  $("#addForm").onsubmit = e => {
    e.preventDefault();
    const n = $("#addName").value.trim(); if (!n) return;
    S.list.push({ id:uid(), name:n, qty:0, unit:"", sec:$("#addSec").value, pantry:false, checked:false, meals:[] });
    save(); renderAll(); $("#addName").focus();
  };
  $("#tgPantry").onclick = () => { hidePantry = !hidePantry; renderList(); };
  $("#editOrder").onclick = orderSheet;
  const cb = $("#curbside"); if (cb) cb.onclick = () => curbsideSheet();
  const cl = $("#copyList"); if (cl) cl.onclick = copyList;
  const cd = $("#clearDone"); if (cd) cd.onclick = () => { bury(S.list.filter(i => i.checked).map(i => i.id)); S.list = S.list.filter(i => !i.checked); save(); renderAll(); };
  const ca = $("#clearAll"); if (ca) ca.onclick = confirmClear;
}
$("#v-list").addEventListener("change", e => {
  const id = e.target.dataset.chk; if (!id) return;
  const it = S.list.find(i => i.id === id); if (it) { it.checked = e.target.checked; save(); renderAll(); }
});
$("#v-list").addEventListener("click", e => {
  const b = e.target.closest("[data-rm]"); if (!b) return;
  e.preventDefault();
  bury([b.dataset.rm]); S.list = S.list.filter(i => i.id !== b.dataset.rm); save(); renderAll();
});
function confirmClear(){
  openSheet(`<div class="sheet-head"><h3>Start a new list?</h3><button class="x" data-close aria-label="Close">✕</button></div>
    <p class="blurb">This removes all ${S.list.length} items. Your calorie log stays.</p>
    <div class="actions" style="margin-top:16px"><button class="btn warn" id="yesClear">Clear list</button><button class="btn ghost" data-close>Keep it</button></div>`);
  $("#yesClear").onclick = () => { bury(S.list.map(i => i.id)); S.list = []; S.onList = {}; save(); renderAll(); closeSheet(); toast("List cleared"); };
}
function orderSheet(){
  const draw = () => {
    openSheet(`<div class="sheet-head"><div><span class="label">Wimberley H-E-B</span><h3>Store order & aisles</h3></div><button class="x" data-close aria-label="Close">✕</button></div>
      <p class="blurb">Put sections in the order you walk the store. Add the aisle number from the hanging signs and it shows on your list.</p>
      <ol class="order-list">${S.order.map((k,i) => `<li>
        <span class="stop">${String(i+1).padStart(2,"0")}</span><span class="n">${SECTIONS[k]}</span>
        <input id="ai-${k}" data-aisle="${k}" value="${esc(S.aisles[k]||AISLE_NO[k]||"")}" placeholder="Aisle #" aria-label="Aisle for ${SECTIONS[k]}">
        <button class="mini" data-up="${i}" aria-label="Move ${SECTIONS[k]} up" ${i===0?"disabled":""}>↑</button>
        <button class="mini" data-dn="${i}" aria-label="Move ${SECTIONS[k]} down" ${i===S.order.length-1?"disabled":""}>↓</button></li>`).join("")}</ol>
      <div class="actions"><button class="btn primary" data-close>Done</button><button class="btn ghost" id="resetOrder">Reset to default</button></div>`);
    const sheet = document.querySelector(".sheet");
    sheet.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.up) { const i = +b.dataset.up; [S.order[i-1], S.order[i]] = [S.order[i], S.order[i-1]]; save(); draw(); renderList(); }
      if (b.dataset.dn) { const i = +b.dataset.dn; [S.order[i+1], S.order[i]] = [S.order[i], S.order[i+1]]; save(); draw(); renderList(); }
      if (b.id === "resetOrder") { S.order = DEFAULT_ORDER.slice(); save(); draw(); renderList(); }
    });
    sheet.addEventListener("change", e => {
      const k = e.target.dataset.aisle; if (!k) return;
      S.aisles[k] = e.target.value.trim().slice(0, 8); save(); renderList();
    });
  };
  draw();
}

/* ---------- Log view ---------- */
let logDay = todayKey();
function renderLog(){
  const entries = S.log[logDay] || [];
  const total = dayTotal(logDay), tgt = S.target || 2000;
  const left = tgt - total, over = left < 0;
  const isToday = logDay === todayKey();
  const dLabel = isToday ? "Today" : parseKey(logDay).toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"});

  const days = []; const base = parseKey(logDay);
  for (let i = 6; i >= 0; i--) { const d = new Date(base); d.setDate(d.getDate() - i); days.push(dkey(d)); }
  const maxV = Math.max(tgt * 1.25, ...days.map(dayTotal));
  const tgtPct = tgt / maxV * 100;

  $("#v-log").innerHTML = `
    <div class="daynav">
      <button class="btn" id="prevDay" aria-label="Previous day">←</button>
      <strong>${dLabel}</strong>
      <button class="btn" id="nextDay" aria-label="Next day" ${isToday?"disabled":""}>→</button>
    </div>
    <div class="gauge">
      <div class="split"><div class="big">${fmt(total)} <small>/ ${fmt(tgt)} kcal</small></div>
        <span class="label" style="color:${over?"var(--chili)":"var(--accent)"}">${over ? fmt(-left) + " over" : fmt(left) + " left"}</span></div>
      <div class="bar ${over?"over":""}"><i style="width:${Math.min(100,total/tgt*100)}%"></i></div>
      <div class="note">${entries.length} item${entries.length===1?"":"s"} logged${isToday ? "" : " on this day"}</div>
    </div>

    <span class="label">Logged</span>
    ${entries.length ? `<div class="entries" style="margin-top:6px">${entries.map(e => `
      <div class="entry"><div class="nm">${esc(e.name)}<small>${e.mealId ? fmtQty(e.servings) + " serving" + (e.servings===1?"":"s") + " · " + e.kcal + " each" : "Quick add"}</small></div>
      <span class="k">${fmt(Math.round(e.kcal*e.servings))}</span>
      <button class="rm btn ghost" data-del="${e.id}" aria-label="Remove ${esc(e.name)}">✕</button></div>`).join("")}</div>`
    : `<div class="empty" style="margin:6px 0 14px"><b>Nothing logged ${isToday?"yet today":"for this day"}</b>Tap <em>Cooked it</em> on a dinner, or quick-add breakfast, lunch and snacks below.</div>`}

    <span class="label">Add to ${isToday ? "today" : "this day"}</span>
    <form class="quick" id="quick" style="margin-top:6px">
      <input id="qName" placeholder="Breakfast, lunch, snack…" aria-label="What you ate" autocomplete="off">
      <input id="qKcal" type="number" inputmode="numeric" min="0" max="5000" placeholder="kcal" aria-label="Calories">
      <button class="btn primary">Add</button>
    </form>
    <form class="quick" id="quickMeal">
      <select id="qMeal" aria-label="Dinner from the app">${RECIPES.map(r => `<option value="${r.id}">${esc(r.name)} · ${r.kcal}</option>`).join("")}</select>
      <select id="qSv" aria-label="Servings"><option value="0.5">½ ×</option><option value="1" selected>1 ×</option><option value="1.5">1½ ×</option><option value="2">2 ×</option></select>
      <button class="btn">Log dinner</button>
    </form>

    <span class="label" style="display:block;margin-top:14px">Last 7 days</span>
    <div class="week" style="margin-top:6px">
            ${days.map(k => { const v = dayTotal(k); return `<button class="col ${v>tgt?"over":""} ${k===logDay?"sel":""}" data-day="${k}" aria-label="${k}: ${v} kcal">
        <i style="height:${Math.max(1, v/maxV*100)}%"></i><span>${parseKey(k).toLocaleDateString("en-US",{weekday:"narrow"})}</span></button>`; }).join("")}
    </div>

    <div class="settings"><label for="tgt">Daily calorie target</label><input id="tgt" type="number" inputmode="numeric" min="800" max="6000" step="50" value="${tgt}"></div>`;

  $("#prevDay").onclick = () => { const d = parseKey(logDay); d.setDate(d.getDate()-1); logDay = dkey(d); renderLog(); };
  $("#nextDay").onclick = () => { const d = parseKey(logDay); d.setDate(d.getDate()+1); if (dkey(d) <= todayKey()) { logDay = dkey(d); renderLog(); } };
  $("#quick").onsubmit = e => {
    e.preventDefault();
    const n = $("#qName").value.trim(), k = parseInt($("#qKcal").value, 10);
    if (!n || !(k >= 0)) { toast("Add a name and calories"); return; }
    logMeal(n, k, 1, logDay, null);
  };
  $("#quickMeal").onsubmit = e => {
    e.preventDefault();
    const r = recipeById($("#qMeal").value), sv = parseFloat($("#qSv").value);
    logMeal(r.name, r.kcal, sv, logDay, r.id);
  };
  $("#tgt").onchange = e => { const v = parseInt(e.target.value, 10); if (v >= 800 && v <= 6000) { S.target = v; save(); renderAll(); } };
}
$("#v-log").addEventListener("click", e => {
  const del = e.target.closest("[data-del]");
  if (del) { bury([del.dataset.del]); S.log[logDay] = (S.log[logDay]||[]).filter(x => x.id !== del.dataset.del); if (!S.log[logDay].length) delete S.log[logDay]; save(); renderAll(); return; }
  const day = e.target.closest("[data-day]");
  if (day && day.dataset.day <= todayKey()) { logDay = day.dataset.day; renderLog(); }
});

/* ---------- Shell ---------- */
let tab = "meals";
function showTab(t){
  tab = t;
  document.querySelectorAll("nav.tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
  ["meals","list","log"].forEach(k => $("#v-"+k).hidden = k !== t);
  window.scrollTo(0,0);
}
document.querySelectorAll("nav.tabs button").forEach(b => b.onclick = () => showTab(b.dataset.tab));
function renderHeader(){
  $("#todayPill").innerHTML = `Today <b>${fmt(dayTotal(todayKey()))}</b> / ${fmt(S.target||2000)} kcal`;
  const left = S.list.filter(i => !i.checked).length;
  const bdg = $("#listBadge"); bdg.hidden = !left; bdg.textContent = left;
}
function renderAll(){ renderHeader(); renderMeals(); renderList(); renderLog(); }
renderAll();
{ const h = location.hash.slice(1); if (["meals","list","log"].includes(h)) showTab(h); }
if (window.Sync) Sync.init({
  getState: () => JSON.parse(JSON.stringify(S)),
  setState: (data, fromOther) => {
    S = Object.assign(blank(), data); fixOrder(); persist(); renderAll();
    if (fromOther) toast("Updated from your other device");
  },
  onStatus: setSync
});


/* ---------- Curbside helper ----------
 * H-E-B has no public API for lists or carts, so this walks you through the
 * list one item at a time: each item opens a pre-filled search on heb.com
 * (or the H-E-B app, if your phone hands heb.com links to it). */
const HEB_QUERY = {
  "Raw shrimp, peeled (31–40)": "raw peeled deveined shrimp",
  "Thin-sliced ribeye or sirloin": "thin sliced beef",
  "Lo mein or spaghetti noodles": "lo mein noodles",
  "Short-grain or jasmine rice": "jasmine rice",
  "Thai or sweet basil": "thai basil",
  "Thai chiles or serranos": "serrano peppers",
  "Tomato paste (tube or can)": "tomato paste",
  "Dried red chiles (whole)": "dried chile de arbol",
  "Vodka (optional)": ""
};
function hebQuery(name){
  if (name in HEB_QUERY) return HEB_QUERY[name];
  return name.replace(/\(.*?\)/g, "").split(",")[0].replace(/\s+/g, " ").trim().toLowerCase();
}
const hebUrl = name => "https://www.heb.com/search?q=" + encodeURIComponent(hebQuery(name));
function curbItems(){
  const items = [];
  for (const sec of S.order)
    for (const i of S.list.filter(x => x.sec === sec && !(hidePantry && x.pantry)).sort((a,b) => a.name.localeCompare(b.name)))
      if (hebQuery(i.name)) items.push(i);
  return items;
}
function curbsideSheet(startId){
  const items = curbItems();
  let idx = Math.max(0, startId ? items.findIndex(i => i.id === startId) : items.findIndex(i => !i.checked));
  const draw = () => {
    const got = items.filter(i => i.checked).length;
    const it = items[idx];
    const allDone = items.every(i => i.checked);
    openSheet(`
      <div class="sheet-head"><div><span class="label">Curbside · ${got} of ${items.length} added</span><h3>Build your H-E-B cart</h3></div>
        <button class="x" data-close aria-label="Close">✕</button></div>
      <div class="curb-dots" aria-hidden="true">${items.map((x,k) => `<i class="${k===idx?"cur":x.checked?"on":""}"></i>`).join("")}</div>
      ${allDone ? `
        <div class="curb-card"><div class="nm">Everything's in your cart</div>
          <div class="sub">Open H-E-B to pick a curbside time and check out.</div></div>
        <a class="curb-go" href="https://www.heb.com/cart" target="_blank" rel="noopener">Go to my H-E-B cart</a>
      ` : `
        <div class="curb-card">
          <div class="nm">${esc(it.name)}</div>
          <div class="sub">${it.qty ? "Need " + fmtQty(it.qty) + " " + esc(it.unit || "") + " · " : ""}${esc(SECTIONS[it.sec] || "")}${it.pantry ? " · check pantry first" : ""}</div>
        </div>
        <a class="curb-go" href="${hebUrl(it.name)}" target="_blank" rel="noopener" id="goHeb">Search H-E-B for “${esc(hebQuery(it.name))}”</a>
        <div class="curb-row">
          <button class="btn primary" id="curbAdded">Added to cart ✓</button>
          <button class="btn" id="curbSkip">${it.pantry ? "Have it, skip" : "Skip for now"}</button>
        </div>
        <div class="row" style="justify-content:space-between;margin-top:10px">
          <button class="btn ghost" id="curbPrev" ${idx===0?"disabled":""}>← Back</button>
          <a class="btn ghost" href="https://www.heb.com/cart" target="_blank" rel="noopener" style="text-decoration:none">Open cart</a>
        </div>`}
      <details style="margin-top:14px"><summary class="label" style="cursor:pointer">All items</summary>
        <ul class="curb-list">${items.map((x,k) => `<li class="${x.checked?"got":""}"><span>${esc(x.name)}</span><button class="btn ghost" data-jump="${k}">${x.checked?"Undo":"Go"}</button></li>`).join("")}</ul>
      </details>
      <p class="fine">Tip: put the H-E-B app and this app side by side in the app switcher. Search opens in H-E-B, add the item, then swipe back here and tap <em>Added</em>.</p>`);
    const nextOpen = () => { const n = items.findIndex((x,k) => k > idx && !x.checked); const f = items.findIndex(x => !x.checked); idx = n >= 0 ? n : (f >= 0 ? f : idx); };
    const add = $("#curbAdded"); if (add) add.onclick = () => { it.checked = true; save(); renderAll(); nextOpen(); draw(); };
    const sk = $("#curbSkip"); if (sk) sk.onclick = () => {
      if (it.pantry) { it.checked = true; save(); renderAll(); }
      // next unchecked item after this one, wrapping around; stay put if it's the only one left
      for (let step = 1; step <= items.length; step++) { const k = (idx + step) % items.length; if (!items[k].checked) { idx = k; break; } }
      draw();
    };
    const pv = $("#curbPrev"); if (pv) pv.onclick = () => { idx = Math.max(0, idx - 1); draw(); };
    document.querySelectorAll("[data-jump]").forEach(b => b.onclick = () => {
      const k = +b.dataset.jump;
      if (items[k].checked) { items[k].checked = false; save(); renderAll(); }
      idx = k; draw();
    });
  };
  if (!items.length) { toast("Nothing left to order"); return; }
  draw();
}
async function copyList(){
  const lines = [];
  for (const sec of S.order) {
    const rows = S.list.filter(i => i.sec === sec && !i.checked && !(hidePantry && i.pantry));
    if (!rows.length) continue;
    lines.push((AISLE_NO[sec] ? "Aisle " + AISLE_NO[sec] + " – " : "") + SECTIONS[sec]);
    for (const i of rows.sort((a,b) => a.name.localeCompare(b.name))) lines.push("• " + i.name + (i.qty ? " (" + fmtQty(i.qty) + " " + (i.unit || "") + ")" : ""));
    lines.push("");
  }
  const txt = lines.join("\n").trim();
  try { await navigator.clipboard.writeText(txt); toast("List copied"); }
  catch (e) {
    openSheet(`<div class="sheet-head"><h3>Copy list</h3><button class="x" data-close aria-label="Close">✕</button></div>
      <textarea class="field bk" id="copyTxt" rows="12" aria-label="Grocery list text">${esc(txt)}</textarea>`);
    const t = $("#copyTxt"); t.focus(); t.select();
  }
}
