"""Extract a Furniture data file from ao-bin-dumps items.json.

Outputs albion/furniture.json which the main extractor merges into the
recipe set. We treat furniture as a single virtual sheet ("Furniture") with
sections per item-line (Chest / Bed / Table / Trophy Shark) and one tier per
row, no enchantment variants.

Re-run only when adding new furniture items. items.json must be present in
the project root (download with:
  curl -L https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/items.json -o items.json
)."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent

with (ROOT / 'items.json').open(encoding='utf-8') as f:
    items_data = json.load(f)

# Index every item by uniquename
def walk(node, out):
    if isinstance(node, dict):
        if '@uniquename' in node:
            out[node['@uniquename']] = node
        for v in node.values():
            walk(v, out)
    elif isinstance(node, list):
        for i in node:
            walk(i, out)

ITEMS = {}
walk(items_data['items'], ITEMS)

# Map a craftresource @uniquename -> our material id (PLANKS_T4.0 etc.)
RAW_FAMILY = {
    'METALBAR': 'STEEL', 'PLANKS': 'PLANKS', 'PLANK': 'PLANKS',
    'LEATHER': 'LEATHER', 'CLOTH': 'CLOTH', 'STONEBLOCK': 'BLOCKS', 'ROCK': 'BLOCKS',
}
def material_id_for(uniquename):
    """e.g. 'T4_PLANKS' -> 'PLANKS_T4.0' (we use enchant 0 for furniture)."""
    m = re.match(r'^T(\d+)_([A-Z]+)(?:_LEVEL(\d+))?$', uniquename)
    if not m: return None
    tier = int(m.group(1))
    suffix = m.group(2)
    ench  = int(m.group(3) or '0')
    fam = RAW_FAMILY.get(suffix)
    if not fam: return None
    tier_str = f'{tier}.{ench}' if tier >= 4 else str(tier)
    return f'{fam}_T{tier_str}'

def craft_items_for(item_id):
    item = ITEMS.get(item_id)
    if not item: return None
    cr = item.get('craftingrequirements')
    if isinstance(cr, list): cr = cr[0]
    if not cr or 'craftresource' not in cr: return None
    crs = cr['craftresource']
    if isinstance(crs, dict): crs = [crs]
    out = []
    for c in crs:
        un = c['@uniquename']
        # skip avalon-token / quest-token style ingredients
        if un.startswith('QUESTITEM_') or un.startswith('UNIQUE_'):
            continue
        mid = material_id_for(un)
        if not mid:
            continue
        out.append({'mat': mid, 'qty': float(c['@count'])})
    return out

def localized_name(item_id):
    """Return the bare English name for an item, sans 'Adept's' / 'Elder's' prefix."""
    nm = ITEMS.get(item_id, {}).get('@uniquename')
    return nm

# ---------- Recipe lines ----------
# (section, [(tier, item_id), ...]) — section name is the user-facing label.
FURNITURE_LINES = [
    ('Chest',  [(t, f'T{t}_FURNITUREITEM_CHEST') for t in (2, 3, 4, 5)]),
    ('Bed',    [(t, f'T{t}_FURNITUREITEM_BED')   for t in range(2, 9)]),
    ('Table',  [(t, f'T{t}_FURNITUREITEM_TABLE') for t in range(2, 9)]),
    ('Trophy Shark', [(8, 'T8_FURNITUREITEM_TROPHY_FISHING_BOSS')]),
]

recipes = []
for section, rows in FURNITURE_LINES:
    for tier, iid in rows:
        items = craft_items_for(iid)
        if not items:
            continue
        recipes.append({
            'sheet': 'Furniture',
            'section': section,
            'item': f'{section} Tier {tier}',
            'tierLabel': f'Tier {tier}',
            'enchantments': {0: items},
        })

# Icon map: section -> a representative T8 (or T-best) item id.
ICON_MAP = {
    'Chest':         'T5_FURNITUREITEM_CHEST',  # T5 is the highest existing
    'Bed':           'T8_FURNITUREITEM_BED',
    'Table':         'T8_FURNITUREITEM_TABLE',
    'Trophy Shark':  'T8_FURNITUREITEM_TROPHY_FISHING_BOSS',
}

out = {'recipes': recipes, 'icons': ICON_MAP}
out_path = ROOT / 'albion' / 'furniture.json'
out_path.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding='utf-8')
print(f'Wrote {out_path} with {len(recipes)} recipes.')
for r in recipes:
    short = [(it['mat'], it['qty']) for it in r['enchantments'][0]]
    print(f"  [{r['section']:14s}] {r['tierLabel']:8s} -> {short}")
