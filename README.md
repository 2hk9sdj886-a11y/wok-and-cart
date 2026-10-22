# Wok & Cart

A personal dinner planner you install on your phone:

- **Meals** – 14 flavor-forward dinners (stir fries, rice bowls, pasta, noodles) with calories per serving, scalable ingredients and steps.
- **List** – one tap sends a meal's ingredients to a grocery list, combined across meals and sorted by aisle for the **Wimberley H-E-B (store 708)**.
- **Log** – log what you cooked (any date), quick-add other meals, and track daily calories against a target with a 7-day chart.

It works offline. With a free Supabase account it syncs between your phone and computer.

## How it's built

Plain HTML/CSS/JS with no build step, hosted on GitHub Pages.

| File | What it does |
| --- | --- |
| `index.html` | Page shell |
| `styles.css` | Look and feel (light + dark) |
| `recipes.js` | Recipes, calories, store sections and aisle mapping |
| `app.js` | Meals, grocery list and calorie log |
| `sync.js` | Sign-in and sync with Supabase (REST API, no SDK) |
| `account.js` | Account sheet, backups, install prompt, offline setup |
| `config.js` | Your Supabase URL + publishable key |
| `sw.js` | Offline cache. **Bump `VERSION` when you change files** so phones update |
| `manifest.webmanifest`, `icons/` | Home-screen app name and icon |
| `supabase/schema.sql` | Database table and security rules |

### Sync

Each signed-in user has one row in `planner_state`. Every change saves to the device first, then syncs. If two devices changed things since the last sync, list items and log entries are combined (deletions carry over); for settings, the device that syncs last wins. The app checks for changes when it opens, when you come back to it, and every 20 seconds while it's open.

## One-time setup

### 1. Supabase (database + login)

1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor** → paste `supabase/schema.sql` → **Run**.
3. **Authentication → Users → Add user → Create new user**: your email and a password, with **Auto Confirm User** checked.
4. **Authentication → Sign In / Providers**: turn off **Allow new users to sign up**.
5. **Project Settings → API Keys**: copy the **Project URL** and the **publishable** key (or legacy *anon public* key) into `config.js`. Never use the secret / `service_role` key.

### 2. GitHub Pages (hosting)

Repo **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, Branch = `main`, folder = `/ (root)` → **Save**. After a minute the app is live at
`https://<your-username>.github.io/wok-and-cart/`.

### 3. Install on your phone

- **iPhone (Safari):** open the link → **Share** → **Add to Home Screen**. Open it from the home screen and sign in *there*, because the installed app keeps its own storage separate from Safari.
- **Android (Chrome):** open the link → **Install app** (or ⋮ → *Add to Home screen*).
- **Computer:** open the link in Chrome or Edge and click the install icon in the address bar, or just bookmark it.

## Changing things

- **Recipes:** edit `recipes.js`. Each ingredient is `[name, qty, unit, section, pantry?]`. Add a name to `STORE_SEC` to pin it to a specific aisle.
- **Store layout:** in the app, open **List → Store order & aisles**. That's saved per account.
- After any file change, bump `VERSION` in `sw.js`, then commit. Phones pick it up the next time the app opens with signal.
