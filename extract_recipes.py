"""Extract recipe data from Nendys V2 spreadsheet into JSON.

Approach:
- Build a material map: cell coord (e.g. 'I12') -> material id (e.g. 'STEEL_T1')
- For every craft sheet, scan recipe rows for cost formulas that reference Materials!$X$Y.
- Parse each formula into: list of {material_id, qty}, item tier label, enchantment.
- Output single JSON consumed by the website.
"""
import json
import re
from openpyxl import load_workbook

PATH = r'C:\Users\Bernardo\Downloads\Nendys V2 (7).xlsx'
OUT = r'C:\Users\Bernardo\Desktop\Graf Site\.claude\worktrees\keen-hypatia-1d2f88\albion\data.json'

wb = load_workbook(PATH, data_only=False)


# ---------- BUILD MATERIAL MAP ----------
# Materials sheet structure:
# Refined (rows 9-66): B/G/L/Q/V are labels; D/I/N/S/X are prices.
#   Row 9 headers: B=PLANKS G=STEEL L=LEATHER Q=CLOTH V=BLOCKS
#   Tier rows: 12=T1, 14=T2, 16=T3, 18=T4.0, 20=T4.1, 22=T4.2, 24=T4.3, 26=T4.4,
#              28=T5.0, 30=T5.1, 32=T5.2, 34=T5.3, 36=T5.4,
#              38=T6.0, 40=T6.1, 42=T6.2, 44=T6.3, 46=T6.4,
#              48=T7.0, 50=T7.1, 52=T7.2, 54=T7.3, 56=T7.4,
#              58=T8.0, 60=T8.1, 62=T8.2, 64=T8.3, 66=T8.4
# Stone shifts: V12-V26 are T1-T8 only (basic), but matches B12-B26 same pattern in "raw" section.
# Raw (rows 78-135) same column layout.
# Special: column X (rows 33,35,37,39,41,43,45) = hearts; V52,V54,V56 = Tome/Siphoned/Avalonian; V58-66 = sigils.

REFINED_TIERS = {
    12: 'T1', 14: 'T2', 16: 'T3',
    18: 'T4.0', 20: 'T4.1', 22: 'T4.2', 24: 'T4.3', 26: 'T4.4',
    28: 'T5.0', 30: 'T5.1', 32: 'T5.2', 34: 'T5.3', 36: 'T5.4',
    38: 'T6.0', 40: 'T6.1', 42: 'T6.2', 44: 'T6.3', 46: 'T6.4',
    48: 'T7.0', 50: 'T7.1', 52: 'T7.2', 54: 'T7.3', 56: 'T7.4',
    58: 'T8.0', 60: 'T8.1', 62: 'T8.2', 64: 'T8.3', 66: 'T8.4',
}
RAW_TIERS = {
    81: 'T1', 83: 'T2', 85: 'T3',
    87: 'T4.0', 89: 'T4.1', 91: 'T4.2', 93: 'T4.3', 95: 'T4.4',
    97: 'T5.0', 99: 'T5.1', 101: 'T5.2', 103: 'T5.3', 105: 'T5.4',
    107: 'T6.0', 109: 'T6.1', 111: 'T6.2', 113: 'T6.3', 115: 'T6.4',
    117: 'T7.0', 119: 'T7.1', 121: 'T7.2', 123: 'T7.3', 125: 'T7.4',
    127: 'T8.0', 129: 'T8.1', 131: 'T8.2', 133: 'T8.3', 135: 'T8.4',
}

# (price_col, family) per refined section
REFINED_COLS = {'D': 'PLANKS', 'I': 'STEEL', 'N': 'LEATHER', 'S': 'CLOTH', 'X': 'BLOCKS'}
RAW_COLS = {'D': 'LOGS', 'I': 'ORE', 'N': 'HIDE', 'S': 'FIBER', 'X': 'STONE'}

mat_map = {}      # 'I12' -> id
mat_meta = {}     # id -> {family,tier,name,kind}

# Refined
for col, family in REFINED_COLS.items():
    for row, tier in REFINED_TIERS.items():
        mid = f'{family}_{tier}'
        mat_map[f'{col}{row}'] = mid
        mat_meta[mid] = {'id': mid, 'family': family, 'tier': tier, 'kind': 'refined',
                         'name': f'{family.title()} {tier}'}

# Raw
for col, family in RAW_COLS.items():
    for row, tier in RAW_TIERS.items():
        mid = f'{family}_{tier}'
        mat_map[f'{col}{row}'] = mid
        mat_meta[mid] = {'id': mid, 'family': family, 'tier': tier, 'kind': 'raw',
                         'name': f'{family.title()} {tier}'}

# Special: Stone column V uses RAW_TIERS but with shifted labels:
# V81=T1...V95=T5.0...V119=T8.0  -> override label
stone_override = {
    81:'T1',83:'T2',85:'T3',87:'T4.0',89:'T4.1',91:'T4.2',93:'T4.3',
    95:'T5.0',97:'T5.1',99:'T5.2',101:'T5.3',
    103:'T6.0',105:'T6.1',107:'T6.2',109:'T6.3',
    111:'T7.0',113:'T7.1',115:'T7.2',117:'T7.3',
    119:'T8.0',121:'T8.1',123:'T8.2',125:'T8.3',
}
# But V column on raw section follows "shifted" labels per spreadsheet header.
# Use the labels from the actual header strings instead. Use refined tier mapping for V.
# Actually inspecting earlier dump: V is BLOCKS in refined section (V9 header), prices in X.
# In raw section (V78 STONE), prices in X column. Already covered by mat_map['X<row>'] above with family STONE.
# So for raw STONE, the mapping is X81..X135. Good.

# Hearts (column X, rows 33-45 odd-ish in refined section)
HEARTS = {33: 'Beastheart', 35: 'Mountainheart', 37: 'Treeheart',
          39: 'Rockheart', 41: 'Vineheart', 43: 'Faerie Fire', 45: 'Shadowheart'}
for row, name in HEARTS.items():
    mid = f'HEART_{name.upper().replace(" ","_")}'
    mat_map[f'X{row}'] = mid
    mat_meta[mid] = {'id': mid, 'family': 'HEART', 'tier': '-', 'kind': 'heart', 'name': name}

# Misc (V column rows 52,54,56,58-66)
MISC = {
    52: 'Tome of Insight', 54: 'Siphoned Energy', 56: 'Avalonian Energy',
    58: 'Royal Sigil T4', 60: 'Royal Sigil T5', 62: 'Royal Sigil T6',
    64: 'Royal Sigil T7', 66: 'Royal Sigil T8',
}
for row, name in MISC.items():
    mid = 'MISC_' + name.upper().replace(' ', '_').replace('.', '')
    mat_map[f'X{row}'] = mid
    mat_meta[mid] = {'id': mid, 'family': 'MISC', 'tier': '-', 'kind': 'misc', 'name': name}

# Food & Potion materials (rows 148-210)
# Each label column (B, G, L, Q, V) carries multiple sub-categories stacked
# vertically. UPPERCASE rows are sub-category headers (CROPS, HERBS, MILK,
# EGGS, BREWING, WHEAT PRODUCTS, RAW MEAT, ANIMALS, SHADOW CLAWS, SYLVIAN
# ROOT, WEREWOLF FANGS, SPIRIT PAWS, IMP'S HORNS, RUNESTONE TOOTH, DAWNFEATHER,
# OTHER ITEMS). Items below each header inherit it as their sub-category.
ws = wb['Materials']
for c_letter, p_letter in [('B','D'), ('G','I'), ('L','N'), ('Q','S'), ('V','X')]:
    current_sub = 'OTHER'
    for r in range(140, 210):
        name_cell = ws[f'{c_letter}{r}'].value
        if not (name_cell and isinstance(name_cell, str) and name_cell.strip()):
            continue
        v = name_cell.strip()
        # Sub-category header — uppercase short string
        if v.isupper() and len(v) <= 20:
            current_sub = v
            continue
        mid = 'FP_' + v.upper().replace(' ', '_').replace('-', '_').replace("'", '').replace(',', '')
        mat_map[f'{p_letter}{r}'] = mid
        mat_meta[mid] = {
            'id': mid,
            'family': 'FOOD_POTION',
            'subFamily': current_sub,
            'tier': '-',
            'kind': 'foodpotion',
            'name': v,
        }

# Enchantment materials (V/X starting around 186-202: extracts, fish products)
# Already covered by the loop above.

# Hideout silver (V204)
mat_map['X204'] = 'MISC_HIDEOUT_SILVER'
mat_meta['MISC_HIDEOUT_SILVER'] = {'id': 'MISC_HIDEOUT_SILVER', 'family': 'MISC',
                                    'tier': '-', 'kind': 'misc', 'name': 'Hideout Silver Cost'}


# ---------- PARSE RECIPE FORMULAS ----------
# Standard pattern: qty * Materials!$col$row
MAT_REF = re.compile(r"(\d+(?:\.\d+)?)\s*\*\s*Materials!\$?([A-Z])\$?(\d+)")
# Hearts-conditional pattern: MAX(N - IF($I$21,1,0),0) * Materials!$col$row
HEART_COND_REF = re.compile(
    r"MAX\(\s*(\d+)\s*-\s*IF\(\$?I\$?\d+\s*,\s*1\s*,\s*0\)\s*,\s*0\)\s*\*\s*Materials!\$?([A-Z])\$?(\d+)",
    re.IGNORECASE,
)
# Plain heart reference: IF($I$21,Materials!$X$33,0)
HEART_IF_REF = re.compile(
    r"IF\(\$?I\$?\d+\s*,\s*Materials!\$?([A-Z])\$?(\d+)\s*,\s*0\)",
    re.IGNORECASE,
)
# Any leftover Materials! reference (qty assumed 1)
SIMPLE_REF = re.compile(r"Materials!\$?([A-Z])\$?(\d+)")

def parse_formula(formula):
    """Returns list of {mat, qty, heartReducesQty?, heartGated?}.

    - heartReducesQty: when useHearts is on, subtract 1 from qty.
    - heartGated: when useHearts is off, omit (qty *= 0).
    """
    if not formula or not isinstance(formula, str):
        return None
    f = formula.strip()
    if not f.startswith('='):
        return None
    items = []
    found = set()  # coords already captured

    # 1) Heart-conditional quantity: MAX(N - IF($I$21,1,0),0) * Materials!XY
    for m in HEART_COND_REF.finditer(f):
        baseQty = float(m.group(1))
        coord = f'{m.group(2)}{m.group(3)}'
        mid = mat_map.get(coord)
        if mid:
            items.append({'mat': mid, 'qty': baseQty, 'heartReducesQty': True})
            found.add(coord)

    # 2) Standard qty * Materials!XY
    for m in MAT_REF.finditer(f):
        coord = f'{m.group(2)}{m.group(3)}'
        if coord in found:
            continue
        qty = float(m.group(1))
        mid = mat_map.get(coord)
        if mid:
            items.append({'mat': mid, 'qty': qty})
            found.add(coord)

    # 3) Heart references (gated by useHearts toggle): IF($I$21, Materials!$X$33, 0)
    for m in HEART_IF_REF.finditer(f):
        coord = f'{m.group(1)}{m.group(2)}'
        if coord in found:
            continue
        mid = mat_map.get(coord)
        if mid:
            items.append({'mat': mid, 'qty': 1, 'heartGated': True})
            found.add(coord)

    # 4) Catch-all refs without explicit multiplier (qty=1)
    for m in SIMPLE_REF.finditer(f):
        coord = f'{m.group(1)}{m.group(2)}'
        if coord in found:
            continue
        mid = mat_map.get(coord)
        if mid:
            items.append({'mat': mid, 'qty': 1})
            found.add(coord)

    return items if items else None


# Station-fee pattern from Food/Potions formulas:
#   + (NUTRITION * 0.1125 * C16 / 100)
# C16 holds the user-input station fee. NUTRITION is recipe-specific.
STATION_FEE_RE = re.compile(
    r"\(\s*(\d+(?:\.\d+)?)\s*\*\s*0\.1125\s*\*\s*\$?[A-Z]\$?\d+\s*/\s*100\s*\)"
)

# Batch-divisor pattern: ` / N` placed right after the `(1 - V15)` factor.
# Matches a few variants: "(1 - V15)) / 10", "(1 - V15) / 5", etc.
BATCH_RE = re.compile(
    r"\(\s*1\s*-\s*\$?[A-Z]\$?\d+\s*\)\s*\)?\s*/\s*(\d+(?:\.\d+)?)"
)

def parse_station_fee(formula):
    """Returns nutrition value (float) embedded in the station-fee term, or None."""
    if not formula or not isinstance(formula, str):
        return None
    m = STATION_FEE_RE.search(formula)
    return float(m.group(1)) if m else None

def parse_batch_divisor(formula):
    """Returns the batch divisor (e.g. 10 for soups, 5 for potions) or None."""
    if not formula or not isinstance(formula, str):
        return None
    m = BATCH_RE.search(formula)
    if not m:
        return None
    n = float(m.group(1))
    # Sanity: batch sizes are small. Reject garbage like /100 (which is the SF normalizer).
    return n if 1 < n <= 50 else None


# ---------- WALK CRAFT SHEETS ----------
SKIP = {'Intro', 'Instructions', 'Materials', 'Blacksmith', 'Hunter', 'Mage',
        'Refining', 'Food And Potions', 'Tool maker'}

ENCHANT_COLS = {'I': 0, 'K': 1, 'M': 2, 'O': 3, 'Q': 4}

def find_recipe_block_starts(ws):
    """Find rows that start a recipe table. Heuristic: a row that has 'Cost' in column G
    AND has 'Enchantment 0' in column I."""
    starts = []
    for r in range(1, ws.max_row + 1):
        gv = ws.cell(row=r, column=7).value  # G
        iv = ws.cell(row=r, column=9).value  # I
        if isinstance(gv, str) and gv.strip().lower() == 'cost' and isinstance(iv, str) and 'Enchantment 0' in iv:
            # Find the item label: usually column A on the row above 'Cost' or in the next data row's column A
            starts.append(r)
    return starts

def extract_sheet(ws):
    """Yield recipes from a craft/refining sheet."""
    sheet_name = ws.title
    starts = find_recipe_block_starts(ws)
    recipes = []
    for header_row in starts:
        # Find the section name (item base name) - search column A from header_row upward
        section = None
        for rr in range(header_row, max(0, header_row - 20), -1):
            v = ws.cell(row=rr, column=1).value
            if isinstance(v, str) and v.strip() and not v.strip().startswith('*'):
                section = v.strip()
                break
        # Also check column G above header for an item-name column (some sheets use G)
        # Iterate rows below header until next header or empty stretch
        end_row = ws.max_row
        for next_start in starts:
            if next_start > header_row:
                end_row = min(end_row, next_start - 1)
                break
        # Look for tier/item rows: column G has a label, columns I/K/M/O/Q have formulas
        for r in range(header_row + 1, end_row + 1):
            tier_label = ws.cell(row=r, column=7).value  # G
            if not isinstance(tier_label, str) or not tier_label.strip():
                continue
            tier_label = tier_label.strip()
            # Check if there's at least one formula
            has_recipe = False
            row_recipes = {}
            for col_letter, ench in ENCHANT_COLS.items():
                cell = ws[f'{col_letter}{r}']
                f = cell.value
                items = parse_formula(f) if isinstance(f, str) and f.startswith('=') else None
                if items:
                    has_recipe = True
                    row_recipes[ench] = items
            if has_recipe:
                # Determine item name. Some sheets put item name in tier_label (e.g. 'Carrot Soup T1'),
                # others put generic 'Tier 4'. If tier_label starts with 'Tier' and section exists, combine.
                if section and tier_label.lower().startswith('tier'):
                    item_name = f'{section} {tier_label}'
                else:
                    item_name = tier_label
                recipes.append({
                    'sheet': sheet_name,
                    'section': section,
                    'item': item_name,
                    'tierLabel': tier_label,
                    'enchantments': row_recipes,
                })
    return recipes


def extract_gathering_gear(ws):
    """Special-case: GatheringGear uses 6 item columns (I/K/M/O/Q/S) per section.
    Header row contains item names; each subsequent even row is a tier with cost formulas."""
    GEAR_COLS = ['I', 'K', 'M', 'O', 'Q', 'S']
    recipes = []
    # Find header rows (rows where column G has 'Cost')
    headers = []
    for r in range(1, ws.max_row + 1):
        gv = ws.cell(row=r, column=7).value
        if isinstance(gv, str) and gv.strip().lower() == 'cost':
            headers.append(r)

    for hi, hrow in enumerate(headers):
        # Section name from column A on the same row
        section = ws.cell(row=hrow, column=1).value
        section = section.strip() if isinstance(section, str) else f'Section{hi}'
        # Item names in I/K/M/O/Q/S of header row
        item_names = {}
        for col in GEAR_COLS:
            v = ws[f'{col}{hrow}'].value
            if isinstance(v, str) and v.strip():
                item_names[col] = v.strip()

        end_row = headers[hi + 1] - 1 if hi + 1 < len(headers) else ws.max_row
        # Walk tier rows
        for r in range(hrow + 1, end_row + 1):
            tier_label = ws.cell(row=r, column=7).value
            if not isinstance(tier_label, str) or not tier_label.strip():
                continue
            tier_label = tier_label.strip()
            for col in GEAR_COLS:
                if col not in item_names:
                    continue
                f = ws[f'{col}{r}'].value
                items = parse_formula(f) if isinstance(f, str) and f.startswith('=') else None
                if items:
                    recipes.append({
                        'sheet': 'GatheringGear',
                        'section': section,
                        'item': f'{item_names[col]} {tier_label}',
                        'tierLabel': tier_label,
                        'enchantments': {0: items},
                    })
    return recipes


# ---------- ARTIFACT CATALOG PER SHEET ----------
# Each weapon/armor/accessory sheet has up to 6 artifact items in row 5
# (cols I/K/M/O/Q, plus S for CapesFurniture). Tier rows 6/8/10/12/14 = T4-T8.
ARTIFACT_TIER_ROWS = {6: 'T4', 8: 'T5', 10: 'T6', 12: 'T7', 14: 'T8'}
ARTIFACT_COLS = ['I', 'K', 'M', 'O', 'Q', 'S']

# Per-sheet artifact maps: sheet_name -> { local_coord (e.g. 'I6') -> material_id }
sheet_artifact_maps = {}

def slug(s):
    return re.sub(r'[^A-Z0-9]+', '_', s.upper().strip()).strip('_')

def build_artifact_catalog(wb):
    for sn in wb.sheetnames:
        if sn in SKIP or sn == 'GatheringGear':
            continue
        ws = wb[sn]
        # Read artifact NAMES in row 5
        names = {}  # col_letter -> name
        for col in ARTIFACT_COLS:
            v = ws[f'{col}5'].value
            if isinstance(v, str) and v.strip() and v.strip().upper() != 'ARTIFACTS':
                names[col] = v.strip()
        if not names:
            continue
        local_map = {}
        for col, name in names.items():
            for row, tier in ARTIFACT_TIER_ROWS.items():
                mid = f'ART_{slug(sn)}_{slug(name)}_{tier}'
                local_map[f'{col}{row}'] = mid
                mat_meta[mid] = {
                    'id': mid,
                    'family': f'ARTIFACT_{sn}',
                    'tier': tier,
                    'kind': 'artifact',
                    'name': f'{name} {tier}',
                    'sheet': sn,
                }
        sheet_artifact_maps[sn] = local_map

build_artifact_catalog(wb)


# ---------- UPDATE FORMULA PARSER FOR ARTIFACT REFS ----------
# Detect local-sheet refs like `$I$6`, `$K$8` (NOT prefixed with Materials!).
# These point to artifact prices on the same sheet.
LOCAL_REF = re.compile(r"(?<!Materials!)\$([A-Z])\$(\d+)")

def parse_formula_with_artifacts(formula, sheet_name):
    """Wraps parse_formula; additionally detects local artifact refs."""
    items = parse_formula(formula) or []
    if not formula or not isinstance(formula, str):
        return items if items else None
    f = formula.strip()
    if not f.startswith('='):
        return items if items else None

    sheet_map = sheet_artifact_maps.get(sheet_name, {})
    # Find local refs that don't follow `Materials!`
    # Simple approach: iterate matches and check the prefix.
    for m in LOCAL_REF.finditer(f):
        coord = f'{m.group(1)}{m.group(2)}'
        # Skip if this happens to be at a position right after 'Materials!' (already covered)
        start = m.start()
        if start >= len('Materials!'):
            preceding = f[max(0, start - len('Materials!')):start]
            if preceding.endswith('Materials!'):
                continue
        # Only consider artifact rows (6, 8, 10, 12, 14) and artifact cols
        row = int(m.group(2))
        col = m.group(1)
        if row not in ARTIFACT_TIER_ROWS or col not in ARTIFACT_COLS:
            continue
        mid = sheet_map.get(coord)
        if not mid:
            continue
        # Avoid duplicates
        if any(it['mat'] == mid for it in items):
            continue
        # Artifacts are added OUTSIDE the (1-returnFactor) bracket — flag as noReturnDiscount
        items.append({'mat': mid, 'qty': 1, 'noReturnDiscount': True})
    return items if items else None


def extract_sheet_v2(ws):
    """Like extract_sheet, but uses parse_formula_with_artifacts and also
    captures the station-fee nutrition cost (Food/Potions only)."""
    sheet_name = ws.title
    starts = find_recipe_block_starts(ws)
    recipes = []
    for header_row in starts:
        section = None
        for rr in range(header_row, max(0, header_row - 20), -1):
            v = ws.cell(row=rr, column=1).value
            if isinstance(v, str) and v.strip() and not v.strip().startswith('*'):
                section = v.strip()
                break
        end_row = ws.max_row
        for next_start in starts:
            if next_start > header_row:
                end_row = min(end_row, next_start - 1)
                break
        for r in range(header_row + 1, end_row + 1):
            tier_label = ws.cell(row=r, column=7).value
            if not isinstance(tier_label, str) or not tier_label.strip():
                continue
            tier_label = tier_label.strip()
            has_recipe = False
            row_recipes = {}
            row_nutrition = {}  # enchant -> nutrition cost
            row_batch = {}      # enchant -> batch divisor
            for col_letter, ench in ENCHANT_COLS.items():
                cell = ws[f'{col_letter}{r}']
                f = cell.value
                items = (parse_formula_with_artifacts(f, sheet_name)
                         if isinstance(f, str) and f.startswith('=') else None)
                if items:
                    has_recipe = True
                    row_recipes[ench] = items
                    nut = parse_station_fee(f)
                    if nut is not None:
                        row_nutrition[ench] = nut
                    div = parse_batch_divisor(f)
                    if div is not None:
                        row_batch[ench] = div
            if has_recipe:
                if section and tier_label.lower().startswith('tier'):
                    item_name = f'{section} {tier_label}'
                else:
                    item_name = tier_label
                rec = {
                    'sheet': sheet_name,
                    'section': section,
                    'item': item_name,
                    'tierLabel': tier_label,
                    'enchantments': row_recipes,
                }
                if row_nutrition:
                    rec['nutrition'] = row_nutrition
                if row_batch:
                    rec['batch'] = row_batch
                recipes.append(rec)
    return recipes


all_recipes = []
for sn in wb.sheetnames:
    if sn in SKIP:
        continue
    ws = wb[sn]
    if sn == 'GatheringGear':
        rs = extract_gathering_gear(ws)
    else:
        rs = extract_sheet_v2(ws)
    all_recipes.extend(rs)
    print(f'{sn}: {len(rs)} recipes')

# Group recipes by sheet
by_sheet = {}
for r in all_recipes:
    by_sheet.setdefault(r['sheet'], []).append(r)

# Write JSON
import os
os.makedirs(os.path.dirname(OUT), exist_ok=True)

out = {
    'materials': list(mat_meta.values()),
    'recipes': all_recipes,
    'sheets': sorted(by_sheet.keys()),
}
with open(OUT, 'w', encoding='utf-8') as fh:
    json.dump(out, fh, indent=2, ensure_ascii=False)

print(f'\nMaterials: {len(mat_meta)}')
print(f'Recipes:   {len(all_recipes)}')
print(f'Sheets:    {len(by_sheet)}')
print(f'Saved to:  {OUT}')
