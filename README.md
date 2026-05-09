# Nendys Calculator — Web Edition

Web replica of the **Nendys V2** Albion Online crafting / refining / food / potions spreadsheet.
Enter your material prices once, choose your return rate (Island / City / Bonus City / Hideout) and any
bonuses (Bonus Day, Focus, Hearts), and instantly see the cost-per-craft for every tier and enchantment
across **1,700+ recipes** in **39 categories**.

All calculations run locally in your browser. Prices and settings are stored in `localStorage`.

## Live use

Open `index.html` in any modern browser — no build step, no server, no API.

```
git clone https://github.com/ExodiaPrincess/ONLINESHEET.git
cd ONLINESHEET
# open index.html
```

## What it covers

- **Refining** — Plank, Steel, Leather, Cloth, Stone (with Hearts toggle for T4+).
- **Weapons** — Swords, Axes, Maces, Hammers, Quarterstaffs, Spears, Bows, Crossbows, Daggers, all six staff lines.
- **Off-hands** — Shields, Tomes, Torch.
- **Armor** — Plate, Leather, Cloth (helmets, chests, boots/shoes/sandals).
- **Accessories** — Bags, Capes, Gloves, Shapeshifter Staves.
- **Gathering Gear** — Harvester, Skinner, Miner, Quarrier, Lumberjack, Fisherman.
- **Consumables** — Food (53 recipes), Potions (43 recipes).

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
