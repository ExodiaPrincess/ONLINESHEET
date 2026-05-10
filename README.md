# Nendys Calculator — Web Edition

Web replica of the **Nendys V2** Albion Online crafting / refining / food / potions spreadsheet.
Enter your material prices once, choose your return rate (Island / City / Bonus City / Hideout) and any
bonuses (Bonus Day, Focus, Hearts), and instantly see the cost-per-craft for every tier and enchantment
across **1,700+ recipes** in **39 categories**.

All calculations run locally in your browser. Prices and settings are stored in `localStorage`.

## Live use

Open `index.html` in any modern browser. The site is fully static — no build
step, no server-side runtime — but it does authenticate against Supabase so
viewers must be invited members of your community.

```
git clone https://github.com/ExodiaPrincess/ONLINESHEET.git
cd ONLINESHEET
# open index.html
```

## Auth + per-user sync (Supabase)

Sign-in is required. Each user's prices and settings are stored in their own
row in Supabase and follow them across devices.

### One-time Supabase setup
1. Create a new project at https://supabase.com.
2. **Authentication → Providers → Email**: enable; turn **off** "Confirm email".
3. **Authentication → Sign In / Up**: turn **off** "Allow new users to sign up"
   so the only way in is via accounts you create.
4. **Authentication → Users → Add user**: enter email + password to issue a
   credential. Repeat per player.
5. **SQL Editor → New query**: paste the snippet below and run it.

```sql
create table if not exists public.user_data (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  prices      jsonb not null default '{}'::jsonb,
  settings    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.user_data enable row level security;

create policy "Users read their own data"   on public.user_data for select using (auth.uid() = user_id);
create policy "Users insert their own data" on public.user_data for insert with check (auth.uid() = user_id);
create policy "Users update their own data" on public.user_data for update using (auth.uid() = user_id);
```

6. **Project Settings → API**: copy the *Project URL* and *anon public* key
   into `albion/config.js`. (The anon key is designed to be public; RLS is
   what actually protects data.)
7. Commit and redeploy.

## What it covers

- **Refining** — Plank, Steel, Leather, Cloth, Stone (with Hearts toggle for T4+).
- **Weapons** — Swords, Axes, Maces, Hammers, Quarterstaffs, Spears, Bows, Crossbows, Daggers, all six staff lines.
- **Off-hands** — Shields, Tomes, Torch.
- **Armor** — Plate, Leather, Cloth (helmets, chests, boots/shoes/sandals).
- **Accessories** — Bags, Capes, Gloves, Shapeshifter Staves.
- **Gathering Gear** — Harvester, Skinner, Miner, Quarrier, Lumberjack, Fisherman.
- **Consumables** — Food (53 recipes), Potions (43 recipes).
- **Artifacts** — every artifact recipe (Clarent Blade, Kingmaker, Galatine Pair, Carving Blade, Infinity Blade, etc.) for all weapon, armor and accessory families. Artifact prices live on their own tab on the Materials page and are added outside the return-rate bracket, matching the spreadsheet's behaviour.

## How the math works

Every recipe is reduced to:

```
cost = Σ (qty × price) × (1 - effectiveReturnFactor)
       + Σ (qty × price)   for hearts (no return discount)
```

Where the effective return factor mirrors the spreadsheet's `T10`/`V15` formula:

```
returnFactor = 1 - 1 / (1 + (cityBonus + dayBonus + focusBonus) / 100)
```

with `cityBonus = 58` for refining and `33` for crafting at a Bonus City, `18` at a regular City,
`+10` or `+20` for Bonus Day, and `+59` for Focus. Hideout uses your custom rate directly.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell (sidebar + main panel). |
| `styles.css` | Dark theme, responsive layout. |
| `app.js`     | Calculator logic, persistence, import/export. |
| `data.json`  | Auto-extracted recipes + materials map. |
| `extract_recipes.py` | Python tool that re-generates `data.json` from the original `Nendys V2.xlsx`. |

## Re-extracting from a newer spreadsheet version

If a newer Nendys spreadsheet drops, point the script at the new `.xlsx` and run:

```
pip install openpyxl
python extract_recipes.py
```

It rewrites `data.json` in place — no other changes needed.

## Credits

- Original spreadsheet: **Nendys** ([Discord](https://discord.gg/5ek2Y6p9GY)).
- Web port: this repo.
