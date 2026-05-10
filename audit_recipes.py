"""Audit extracted recipes against official Albion craftingrequirements.

For each (sheet, section) in icons.json, look up the corresponding T4 base
item in items.json, pull its `craftingrequirements.craftresource` list, and
compare against the T4 row of my extracted recipe.

Mismatches in the family of the primary refined material (e.g.  PLANKS
where the official recipe says METALBAR / STEEL) are the ones we care
about — the user reported one for Quarterstaffs.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
items_path = ROOT / 'items.json'
with items_path.open(encoding='utf-8') as f:
    item_data = json.load(f)

def walk(node, out):
    if isinstance(node, dict):
        if '@uniquename' in node:
            out[node['@uniquename']] = node
        for v in node.values():
            walk(v, out)
    elif isinstance(node, list):
        for i in node:
            walk(i, out)

items = {}
walk(item_data['items'], items)

# Material id -> recipe family
MAT_TO_FAMILY = {
    'METALBAR': 'STEEL',
    'PLANK':    'PLANKS',
    'PLANKS':   'PLANKS',
    'LEATHER':  'LEATHER',
    'CLOTH':    'CLOTH',
    'STONEBLOCK': 'BLOCKS',
    'ROCK':     'BLOCKS',
}

def family_of_official(uniqname):
    """e.g. 'T4_METALBAR' -> 'STEEL'."""
    m = re.match(r'^T(\d+)_(.+)$', uniqname)
    if not m: return None
    suffix = m.group(2).split('_LEVEL')[0]  # T4_PLANKS_LEVEL1 -> PLANKS
    return MAT_TO_FAMILY.get(suffix)

with (ROOT / 'albion' / 'icons.json').open(encoding='utf-8') as f:
    icons = json.load(f)
with (ROOT / 'albion' / 'data.json').open(encoding='utf-8') as f:
    data = json.load(f)

# Index recipes by (sheet, section, tierLabel)
recipe_idx = {}
for r in data['recipes']:
    if not r.get('section'): continue
    key = (r['sheet'], r['section'], r['tierLabel'])
    if key not in recipe_idx:
        recipe_idx[key] = r

mismatches = []
checked = 0
no_official = 0

for sheet, sec_map in icons.items():
    if sheet.startswith('_'): continue
    for section, item_id in sec_map.items():
        # Convert T8_ to T4_ to find the T4 base recipe
        if not item_id.startswith('T8_') and not item_id.startswith('T4_'):
            continue
        t4_id = 'T4_' + item_id.split('_', 1)[1] if item_id.startswith('T8_') else item_id
        item = items.get(t4_id) or items.get(item_id)
        if not item:
            no_official += 1
            continue
        cr = item.get('craftingrequirements')
        if isinstance(cr, list): cr = cr[0]  # some have multiple variants
        if not cr or 'craftresource' not in cr:
            no_official += 1
            continue
        crs = cr['craftresource']
        if isinstance(crs, dict): crs = [crs]
        # Compute official non-artifact families/quantities
        official = []
        for c in crs:
            fam = family_of_official(c['@uniquename'])
            if fam:
                official.append((fam, int(c['@count'])))
        if not official: continue

        # Compare with the T4.0 row of my recipe (lowest enchant)
        rec_key = None
        for tl in ('Tier 4', 'Tier 4.0'):
            if (sheet, section, tl) in recipe_idx:
                rec_key = (sheet, section, tl); break
        # Special-case food/potion sections that don't have Tier-N labels
        if not rec_key:
            for k in recipe_idx:
                if k[0] == sheet and k[1] == section:
                    rec_key = k; break
        if not rec_key:
            continue
        r = recipe_idx[rec_key]
        items_e0 = r['enchantments'].get('0') or r['enchantments'].get(0) or []
        # Compute extracted families/quantities (non-heart, non-artifact)
        def family_of_mat(mid):
            for fam in ['PLANKS','STEEL','LEATHER','CLOTH','BLOCKS']:
                if mid.startswith(fam + '_'): return fam
            return None
        extracted = []
        for it in items_e0:
            if it.get('heartGated') or it.get('noReturnDiscount'): continue
            fam = family_of_mat(it['mat'])
            if fam:
                extracted.append((fam, int(it['qty'])))

        checked += 1
        # Compare as multisets of (family, qty)
        if sorted(official) != sorted(extracted):
            mismatches.append({
                'sheet': sheet, 'section': section, 'item_id': t4_id,
                'official': official, 'extracted': extracted,
            })

print(f'Checked: {checked}')
print(f'No official data: {no_official}')
print(f'Mismatches: {len(mismatches)}\n')
for m in mismatches:
    print(f"[{m['sheet']}] {m['section']:30s} ({m['item_id']})")
    print(f"   official:  {m['official']}")
    print(f"   extracted: {m['extracted']}")
