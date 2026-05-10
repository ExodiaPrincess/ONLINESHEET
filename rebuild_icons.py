"""Rebuild albion/icons.json by matching every spreadsheet section name
against the official Albion items.txt (English names).

Strategy per section:
1. Try `Adept's <SECTION>` exact-match (Adept's = T4 quality prefix). Take
   the T4_ base ID (no @N enchantment suffix, no _ARTEFACT_ raw artifact item).
2. Fall back to substring match within T4_ items.
3. Some sections aren't equipment (Soups, Salads, Bags, refining outputs);
   keep their existing mappings from the current icons.json.
"""
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Expects items.txt at project root. Download once with:
#   curl -L https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/formatted/items.txt -o items.txt

# Parse items.txt
items = []  # (item_id, english_name)
with (ROOT / 'items.txt').open(encoding='utf-8') as f:
    for line in f:
        m = re.match(r'\s*\d+:\s*(\S+)\s*:\s*(.*?)\s*$', line)
        if m:
            items.append((m.group(1), m.group(2)))

# Index by name (normalized) -> list of (id, raw_name)
def norm(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())

by_name = defaultdict(list)
for iid, name in items:
    by_name[norm(name)].append((iid, name))

# Load existing icons.json (we'll keep the non-equipment sections as-is)
icons_path = ROOT / 'icons.json'
old_icons = json.loads(icons_path.read_text(encoding='utf-8'))

# Sheets that aren't standard equipment — keep existing mappings.
SKIP_SHEETS = {
    'PlankRefining', 'SteelRefining', 'LeatherRefining', 'ClothRefining', 'StoneRefining',
    'BagsSatchelsTracking', 'CapesFurniture',  # mixed special items
    'Food', 'Potions',
    'GatheringGear',  # we handle gathering tools by name
}

# Spreadsheet sometimes uses a different name from the in-game name (typos,
# abbreviations). These overrides map the spreadsheet section directly.
TYPO_OVERRIDES = {
    'Carving Blade':       'Carving Sword',     # T4_2H_CLEAVER_HELL
    'Camlann':             'Camlann Mace',      # T4_2H_MACE_MORGANA
    'Black Monk Staff':    'Black Monk Stave',  # T4_2H_COMBATSTAFF_MORGANA
    'Weaping Repeater':    'Weeping Repeater',  # T4_2H_REPEATINGCROSSBOW_UNDEAD
    'Sarcophagus Shield':  'Sarcophagus',       # T4_OFF_TOWERSHIELD_UNDEAD
    'Aegis Shield':        'Astral Aegis',      # T4_OFF_SHIELD_AVALON
    'Tome':                'Tome of Spells',    # T4_OFF_BOOK
    'Dawnsong Staff':      'Dawnsong',          # T4_2H_FIRE_RINGPAIR_AVALON
    'Artic Staff':         'Arctic Staff',      # T4_2H_FROSTSTAFF_CRYSTAL
    'Evensong Staff':      'Evensong',          # T4_2H_ARCANE_RINGPAIR_AVALON
    'Great Holy':          'Great Holy Staff',  # T4_2H_HOLYSTAFF
    'Lightcaller Staff':   'Lightcaller',       # T4_2H_SHAPESHIFTER_AVALON
    'Feyscale Cowl':       'Feyscale Hat',      # T4_HEAD_CLOTH_FEY
}


def resolve_section(section_name):
    """Return the best T4 item ID for an equipment section name, or None."""
    lookup_name = TYPO_OVERRIDES.get(section_name, section_name)
    # 1) Exact "Adept's <name>" match → that's the T4 item
    target = norm(f"Adept's {lookup_name}")
    for iid, name in by_name.get(target, []):
        if iid.startswith('T4_') and '@' not in iid and 'ARTEFACT' not in iid:
            return iid
    # 2) Fuzzy: any T4 item whose bare name matches.
    target_plain = norm(lookup_name)
    for iid, name in items:
        if not iid.startswith('T4_') or '@' in iid or 'ARTEFACT' in iid:
            continue
        bare = re.sub(r"^Adept's\s+", '', name)
        if norm(bare) == target_plain:
            return iid
    return None


# Rebuild
new_icons = {'_README': old_icons.get('_README', '')}
all_sections = []
unresolved = []

for sheet, sections in old_icons.items():
    if sheet.startswith('_'): continue
    new_icons[sheet] = {}
    if sheet in SKIP_SHEETS:
        # Keep existing mappings for non-equipment / specialised sheets,
        # but we'll resolve gathering gear specially below.
        new_icons[sheet] = dict(sections)
        continue
    for section_name in sections:
        resolved = resolve_section(section_name)
        if resolved:
            new_icons[sheet][section_name] = resolved
            all_sections.append((sheet, section_name, resolved))
        else:
            # Keep old value if any, else mark unresolved
            old_val = sections[section_name]
            new_icons[sheet][section_name] = old_val
            unresolved.append((sheet, section_name, old_val))

# Special handling for GatheringGear — match the tool name (e.g. "Harvester" -> "Adept's Harvester Sickle")
# But the section is the gathering family and the most representative icon is the SET (jacket or cap).
# We'll point each section to the matching tool's T4 base ID:
gg_tools = {
    'Harvester':  'T4_2H_SICKLE',
    'Skinner':    'T4_2H_SKINNINGKNIFE',
    'Miner':      'T4_2H_PICK',
    'Quarrier':   'T4_2H_HAMMER_PICK',
    'Lumberjack': 'T4_2H_AXE_WOODCUTTING',
    'Fisherman':  'T4_2H_FISHINGROD',
}
# Verify these IDs exist; fall back to first item match
for sec, candidate in gg_tools.items():
    found = any(iid == candidate for iid, _ in items)
    if not found:
        # search by tool name
        for iid, name in items:
            if iid.startswith('T4_') and '@' not in iid and sec.lower() in name.lower():
                gg_tools[sec] = iid
                break
new_icons.setdefault('GatheringGear', {}).update(gg_tools)

# Write back
new_icons['_README'] = (
    "Maps a recipe section name (per sheet) to an Albion item ID. Image is "
    "fetched from https://render.albiononline.com/v1/item/{ID}.png?size=96. "
    "T4 (Adept's) is used as the canonical icon. Mappings auto-generated by "
    "rebuild_icons.py from ao-data/ao-bin-dumps items.txt."
)
icons_path.write_text(json.dumps(new_icons, indent=2, ensure_ascii=False), encoding='utf-8')

print(f'Resolved: {len(all_sections)}')
print(f'Unresolved (kept old): {len(unresolved)}')
for sheet, sec, old in unresolved:
    print(f'  [{sheet}] {sec!r} -> kept {old!r}')
