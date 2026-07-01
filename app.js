/* ============================================================================
   Nendys Calculator — Albion Online crafting/refining/food/potion calculator.
   Replicates the core formulas of the Nendys V2 spreadsheet.
   ============================================================================ */

// Delegated image-error handler: any <img data-hide-on-error> that fails to
// load is hidden. Replaces inline onerror= so the CSP can drop 'unsafe-inline'.
// Registered in capture phase because error events do not bubble.
document.addEventListener('error', (e) => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && t.hasAttribute('data-hide-on-error')) {
    t.style.display = 'none';
  }
}, true);

const STORAGE_KEY = 'nendys.v2';
const PRICES_KEY  = 'nendys.prices';

// Bonus city return rate per sheet group. Refining uses 58 (real Albion 58.5%
// bonus city), everything else uses 33 (33.5% crafting bonus).
const REFINING_SHEETS = new Set([
  'LeatherRefining', 'StoneRefining', 'PlankRefining', 'SteelRefining', 'ClothRefining',
]);

// Grouping for the sidebar — which sheets fall under which collapsible group.
// Each group uses an Albion item icon as its glyph (rendered via the same
// render.albiononline.com API as the recipe-table icons).
const SHEET_GROUPS = [
  { title: 'Refining',         icon: 'T8_METALBAR',         sheets: ['PlankRefining', 'SteelRefining', 'LeatherRefining', 'ClothRefining', 'StoneRefining'] },
  { title: 'Weapons · Warrior',icon: 'T8_MAIN_SWORD',       sheets: ['Swords', 'Axes', 'Maces', 'Hammers', 'Gloves'] },
  { title: 'Weapons · Hunter', icon: 'T8_2H_BOW',           sheets: ['Bows', 'Crossbows', 'Daggers', 'Spears', 'Quarterstaffs', 'NatureStaff', 'ShapeShifters'] },
  { title: 'Weapons · Mage',   icon: 'T8_MAIN_FIRESTAFF',   sheets: ['CursedStaff', 'FrostStaff', 'ArcaneStaff', 'HolyStaffs', 'FireStaff'] },
  { title: 'Off-hands',        icon: 'T8_OFF_SHIELD',       sheets: ['Shields', 'Tomes', 'Torch'] },
  { title: 'Armor · Plate',    icon: 'T8_HEAD_PLATE_SET1',  sheets: ['PlateHelmets', 'PlateArmors', 'PlateBoots'] },
  { title: 'Armor · Leather',  icon: 'T8_HEAD_LEATHER_SET1',sheets: ['LeatherHoods', 'LeatherJackets', 'LeatherShoes'] },
  { title: 'Armor · Cloth',    icon: 'T8_HEAD_CLOTH_SET1',  sheets: ['ClothCowls', 'ClothRobes', 'ClothSandals'] },
  { title: 'Accessories',      icon: 'T8_BAG',              sheets: ['BagsSatchelsTracking', 'CapesFurniture', 'Furniture'] },
  { title: 'Gathering Gear',   icon: 'T8_2H_TOOL_PICK',     sheets: [
    'GatheringHarvester', 'GatheringSkinner', 'GatheringMiner',
    'GatheringQuarrier',  'GatheringLumberjack', 'GatheringFisherman',
  ] },
  { title: 'Consumables',      icon: 'T4_POTION_HEAL',      sheets: ['Food', 'Potions'] },
];

const SHEET_LABELS = {
  PlankRefining: 'Plank Refining',
  SteelRefining: 'Steel Refining',
  LeatherRefining: 'Leather Refining',
  ClothRefining: 'Cloth Refining',
  StoneRefining: 'Stone Refining',
  CursedStaff: 'Cursed Staffs',
  FrostStaff: 'Frost Staffs',
  ArcaneStaff: 'Arcane Staffs',
  HolyStaffs: 'Holy Staffs',
  FireStaff: 'Fire Staffs',
  NatureStaff: 'Nature Staffs',
  Quarterstaffs: 'Quarterstaffs',
  HolyStaffs: 'Holy Staffs',
  PlateHelmets: 'Plate Helmets',
  PlateArmors: 'Plate Armors',
  PlateBoots: 'Plate Boots',
  LeatherHoods: 'Leather Hoods',
  LeatherJackets: 'Leather Jackets',
  LeatherShoes: 'Leather Shoes',
  ClothCowls: 'Cloth Cowls',
  ClothRobes: 'Cloth Robes',
  ClothSandals: 'Cloth Sandals',
  BagsSatchelsTracking: 'Bags, Satchels & Tracking',
  CapesFurniture: 'Capes',
  ShapeShifters: 'Shapeshifter Staves',
  GatheringGear:       'Gathering Gear',
  GatheringHarvester:  'Harvester',
  GatheringSkinner:    'Skinner',
  GatheringMiner:      'Miner',
  GatheringQuarrier:   'Quarrier',
  GatheringLumberjack: 'Lumberjack',
  GatheringFisherman:  'Fisherman',
  Furniture:           'Furniture',
};

// =============================================================================
// STATE
// =============================================================================
const State = {
  data: null,            // loaded from data.json
  icons: {},             // loaded from icons.json: { sheet: { section: itemId } }
  user: null,            // Supabase user object (null if not signed in)
  prices: {},            // mat_id -> price (number)
  settings: {
    location: 'city',         // island | city | bonusCity | hideout
    bonusDay: 'none',         // none | b10 | b20
    focus: false,
    hideoutRate: 50,          // % when location=hideout
    stationFee: 1000,         // for food/potions
    useHearts: false,         // for refining T4+
    pricingMode: 'auto',      // refining only: auto | market | chain
  },
  view: { type: 'home', sheet: null },
};

/** Inline SVG warning triangle. Inherits color via `currentColor` so its
 *  hue tracks `.danger-icon { color: ... }` in CSS. */
const DANGER_ICON = `<svg class="danger-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M12 3 L22 20 L2 20 Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
  <line x1="12" y1="10" x2="12" y2="14.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
  <circle cx="12" cy="17.3" r="1.2" fill="currentColor"/>
</svg>`;

/** Column-header label for an enchantment slot. Most sheets show
 *  "Enchantment 0/1/2/3/4" — the enchant level of the output. Stone
 *  Refining is special: the output is always a BASE (non-enchanted)
 *  stoneblock regardless of input, so each column represents what
 *  enchant level of raw rock you fed in instead.  */
const STONE_ENCH_LABELS = ['Base Stone', 'Uncommon Stone', 'Rare Stone', 'Exceptional Stone'];
function enchHeaderLabel(sheet, e) {
  if (sheet === 'StoneRefining' && STONE_ENCH_LABELS[e]) return STONE_ENCH_LABELS[e];
  return `Enchantment ${e}`;
}

/** Per-enchant output count for Stone Refining.
 *  Albion's stoneblocks have no enchant variants, so refining 1 enchanted
 *  raw rock outputs *multiple* base blocks instead — 2/4/8 for uncommon/
 *  rare/exceptional. The recipe inputs already scale (e.g. exceptional
 *  consumes 8x the prev-tier blocks); we divide the total recipe cost by
 *  this multiplier to get the per-block cost users actually see in game.
 *  Base enchant outputs 1 block, so divisor 1 is a no-op. */
const STONE_OUTPUT_PER_ENCH = [1, 2, 4, 8];
function refiningOutputCount(sheet, ench) {
  if (sheet === 'StoneRefining') return STONE_OUTPUT_PER_ENCH[ench] || 1;
  return 1;
}

/** Resolve a material id to its current price (or null if unset / invalid). */
function priceFor(matId) {
  const raw = State.prices[matId];
  if (raw == null || raw === '' || isNaN(raw)) return null;
  return Number(raw);
}

/** Build the URL for an icon id. Plain Albion item ids (T1_..., UNIQUE_...)
 *  route to the render API. Anything that looks like a path or filename
 *  (contains '/' or '.') is treated as a local asset so we can ship our
 *  own art for items Albion doesn't have proper renderings of. */
function iconUrl(id, size = 96) {
  if (!id) return null;
  if (id.indexOf('/') !== -1 || id.indexOf('.') !== -1) return id;
  return `https://render.albiononline.com/v1/item/${id}.png?size=${size}`;
}

/** Render an Albion item icon for nav / landing card use. */
function navIcon(itemId, size = 'md') {
  if (!itemId) return '';
  const cls = `nav-emoji nav-emoji--${size}`;
  return `<img class="${cls}" src="${iconUrl(itemId, 64)}" alt="" loading="lazy" data-hide-on-error />`;
}

// =============================================================================
// PERSISTENCE
// =============================================================================
function loadStored() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    Object.assign(State.settings, sanitizeSettings(s.settings || {}));
  } catch {}
  try {
    const raw = JSON.parse(localStorage.getItem(PRICES_KEY) || '{}');
    State.prices = sanitizePrices(raw);
  } catch { State.prices = {}; }
}

/** Drop unknown material ids and coerce values to non-negative numbers.
 *  Defends against malicious Import JSON / tampered localStorage / cloud
 *  rows from a previous schema. Falls open (returns plain prices) if data
 *  hasn't loaded yet so the boot order doesn't matter. */
function sanitizePrices(o) {
  if (!o || typeof o !== 'object') return {};
  const validIds = State.data && State.data.materials
    ? new Set(State.data.materials.map(m => m.id))
    : null;
  const out = {};
  for (const k of Object.keys(o)) {
    if (typeof k !== 'string') continue;
    if (validIds && !validIds.has(k)) continue;
    const n = Number(o[k]);
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

/** Whitelist allowed setting keys to known values / typed primitives. */
function sanitizeSettings(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  if (['island','city','bonusCity','hideout'].includes(o.location)) out.location = o.location;
  if (['none','b10','b20'].includes(o.bonusDay))                    out.bonusDay = o.bonusDay;
  if (['auto','market','chain'].includes(o.pricingMode))            out.pricingMode = o.pricingMode;
  if (typeof o.focus     === 'boolean') out.focus     = o.focus;
  if (typeof o.useHearts === 'boolean') out.useHearts = o.useHearts;
  const hr = Number(o.hideoutRate);
  if (Number.isFinite(hr) && hr >= 0 && hr <= 100) out.hideoutRate = hr;
  const sf = Number(o.stationFee);
  if (Number.isFinite(sf) && sf >= 0 && sf <= 1_000_000) out.stationFee = sf;
  return out;
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings: State.settings }));
  if (typeof clearChainCache === 'function') clearChainCache();
  // Mirror to Supabase if logged in. (Debounced inside NendysSync.save.)
  if (window.NendysSync && State.user) NendysSync.save(State.prices, State.settings);
}
function savePrices() {
  localStorage.setItem(PRICES_KEY, JSON.stringify(State.prices));
  if (typeof clearChainCache === 'function') clearChainCache();
  if (window.NendysSync && State.user) NendysSync.save(State.prices, State.settings);
}

// =============================================================================
// FORMULA
// =============================================================================
/** Effective return-rate factor — i.e. fraction of materials NOT consumed.
 *  cost = qty * price * (1 - returnFactor)
 *  Mirrors the Nendys T10 / V15 IF chain. */
function returnFactor(sheet) {
  const s = State.settings;
  if (s.location === 'hideout') return Math.max(0, Math.min(1, s.hideoutRate / 100));
  // Bonus city differs by sheet group
  const isRefining = REFINING_SHEETS.has(sheet);
  let cityBonus = 0;
  if (s.location === 'bonusCity') cityBonus = isRefining ? 58 : 33;
  else if (s.location === 'city') cityBonus = 18;
  // Bonus day
  let dayBonus = 0;
  if (s.bonusDay === 'b10') dayBonus = 10;
  else if (s.bonusDay === 'b20') dayBonus = 20;
  // Focus (only valid in cities/bonus, ignored on island)
  const focusBonus = (s.focus && s.location !== 'island') ? 59 : 0;
  const r = (cityBonus + dayBonus + focusBonus) / 100;
  // Spreadsheet formula: 1 - 1/(1+r)
  return 1 - 1 / (1 + r);
}

// =============================================================================
// REFINING — CHAIN COST
// =============================================================================
// On refining pages we offer three modes:
//   - 'market' : prev-tier refined ingredient is priced at the user's market
//                price (today's behaviour).
//   - 'chain'  : prev-tier refined ingredient is priced at our COMPUTED cost
//                of refining it ourselves (recursively).
//   - 'auto'   : per cell, pick whichever is cheaper. Also tags the cell so
//                the UI can show an M/C badge.
//
// The cache keys on (sheet, refinedFamily, tier, ench) and is cleared whenever
// prices or settings change so stale values don't leak across renders.

const REFINING_OUTPUT_FAMILY = {
  PlankRefining: 'PLANKS',
  SteelRefining: 'STEEL',
  LeatherRefining: 'LEATHER',
  ClothRefining: 'CLOTH',
  StoneRefining: 'BLOCKS',
};

// T8 refined material image rendered above each refining page's title.
const REFINING_HERO_ICON = {
  PlankRefining: 'T8_PLANKS',
  SteelRefining: 'T8_METALBAR',
  LeatherRefining: 'T8_LEATHER',
  ClothRefining: 'T8_CLOTH',
  StoneRefining: 'T8_STONEBLOCK',
};

/** Pick a representative item icon for a sheet — used on the group landing
 *  cards so each sheet card has an image. Refining gets the T8 refined
 *  material; everything else uses the first item in its icons.json mapping
 *  (which itself is the first section listed in the spreadsheet, so the
 *  result is stable). */
function previewIconForSheet(sheet) {
  if (REFINING_HERO_ICON[sheet]) return REFINING_HERO_ICON[sheet];
  const map = (State.icons || {})[sheet];
  if (map) {
    const firstKey = Object.keys(map)[0];
    if (firstKey) return map[firstKey];
  }
  return null;
}

const _chainCostCache = new Map();
function clearChainCache() { _chainCostCache.clear(); }

/** Parse a refined-material id like "LEATHER_T4.2" → {family, tier, ench}. */
function parseRefinedMatId(id) {
  const m = String(id || '').match(/^([A-Z]+)_T(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  return { family: m[1], tier: Number(m[2]), ench: Number(m[3] || 0) };
}

/** Find the refining recipe row in `sheet` whose tier label is "Tier <n>". */
function findRefiningRecipe(sheet, tierNum) {
  return (State.data.recipes || []).find(r =>
    r.sheet === sheet && r.tierLabel === `Tier ${tierNum}`
  );
}

/** Cost of producing one unit of the refined output of `sheet` at (tier, ench)
 *  by chain-refining: every prev-tier refined ingredient is itself produced
 *  recursively at min(market, chain).
 *  Returns null if any required price is missing along the chain. */
function chainProduceCost(sheet, tier, ench) {
  const family = REFINING_OUTPUT_FAMILY[sheet];
  if (!family) return null;
  const key = `${sheet}|${tier}|${ench}`;
  if (_chainCostCache.has(key)) return _chainCostCache.get(key);

  const recipe = findRefiningRecipe(sheet, tier);
  if (!recipe) { _chainCostCache.set(key, null); return null; }
  const items = recipe.enchantments[String(ench)] || recipe.enchantments[ench];
  if (!items) { _chainCostCache.set(key, null); return null; }

  const ret = returnFactor(sheet);
  const useHearts = !!State.settings.useHearts;
  let total = 0;
  let missingAny = false;

  for (const it of items) {
    if (it.heartGated && !useHearts) continue;
    let qty = it.qty;
    if (it.heartReducesQty && useHearts) qty = Math.max(0, qty - 1);
    if (qty <= 0) continue;

    let unitPrice;
    const parsed = parseRefinedMatId(it.mat);
    const isPrevRefined = parsed && parsed.family === family && parsed.tier < tier;

    if (isPrevRefined) {
      const market   = priceFor(it.mat);
      const produced = chainProduceCost(sheet, parsed.tier, parsed.ench);
      const candidates = [market, produced].filter(v => v != null && !isNaN(v));
      unitPrice = candidates.length ? Math.min(...candidates) : null;
    } else {
      unitPrice = priceFor(it.mat);
    }
    if (unitPrice == null) { missingAny = true; continue; }

    const noDiscount = it.heartGated || it.noReturnDiscount;
    const factor = noDiscount ? 1 : (1 - ret);
    total += qty * unitPrice * factor;
  }
  // Add station fee (paid per craft, not return-rate-refunded), then divide
  // by per-craft output count so the value returned is per-unit (per-block
  // for stone). Non-stone refining outputs 1 per craft → divisor = 1.
  const iv = (recipe.iv && (recipe.iv[String(ench)] ?? recipe.iv[ench])) || 0;
  const stationFee = Number(State.settings.stationFee) || 0;
  total += iv * 0.1125 * stationFee / 100;
  const outCount = refiningOutputCount(sheet, ench);
  if (outCount > 1) total /= outCount;
  const result = missingAny ? null : total;
  _chainCostCache.set(key, result);
  return result;
}

// Set of every refined-output material id (CLOTH_T4.1, BLOCKS_T4, ...), built
// once from the loaded data. Lets a (tier, ench) cell map to the exact material
// whose market price the user entered — handling the per-tier-only ids that
// Stone (BLOCKS_T4) uses vs the per-enchant ids the others use (CLOTH_T4.1).
let _refinedIdSet = null;
function refinedIds() {
  if (!_refinedIdSet) {
    _refinedIdSet = new Set(
      ((State.data && State.data.materials) || [])
        .filter(m => m.kind === 'refined')
        .map(m => m.id)
    );
  }
  return _refinedIdSet;
}
/** Market-price material id for the refined item produced at (tier, ench). */
function refinedOutputId(sheet, tier, ench) {
  const fam = REFINING_OUTPUT_FAMILY[sheet];
  if (!fam) return null;
  const ids = refinedIds();
  const withEnch = `${fam}_T${tier}.${ench}`;
  if (ids.has(withEnch)) return withEnch;
  const noEnch = `${fam}_T${tier}`;
  if (ids.has(noEnch)) return noEnch;
  return null;
}

/** Cost to REFINE this item yourself. `sourcing` controls how each lower-tier
 *  refined ingredient is priced:
 *    'auto'   – cheaper of buying it (market) or making it (chain)
 *    'market' – always buy the ingredient from the market
 *    'chain'  – always chain-refine the ingredient yourself
 *  Raw inputs (fiber, ore, …) are always at market price. Returns
 *  { cost, missing }; cost is null if any required price is missing. */
function refineCostWithMissing(sheet, recipe, tier, ench, sourcing = 'auto') {
  const items = recipe.enchantments[String(ench)] || recipe.enchantments[ench];
  if (!items) return { cost: null, missing: [] };
  const family = REFINING_OUTPUT_FAMILY[sheet];
  const ret = returnFactor(sheet);
  const useHearts = !!State.settings.useHearts;
  let total = 0;
  const missing = [];

  for (const it of items) {
    if (it.heartGated && !useHearts) continue;
    let qty = it.qty;
    if (it.heartReducesQty && useHearts) qty = Math.max(0, qty - 1);
    if (qty <= 0) continue;

    let unitPrice;
    const parsed = parseRefinedMatId(it.mat);
    const isPrevRefined = parsed && family && parsed.family === family && parsed.tier < tier;
    if (isPrevRefined) {
      const market   = priceFor(it.mat);
      const produced = chainProduceCost(sheet, parsed.tier, parsed.ench);
      if (sourcing === 'market')     unitPrice = market;
      else if (sourcing === 'chain') unitPrice = produced;
      else {
        const cands = [market, produced].filter(v => v != null && !isNaN(v));
        unitPrice = cands.length ? Math.min(...cands) : null;
      }
    } else {
      unitPrice = priceFor(it.mat);   // raw inputs are always bought at market
    }
    if (unitPrice == null) { missing.push(it.mat); continue; }

    const noDiscount = it.heartGated || it.noReturnDiscount;
    total += qty * unitPrice * (noDiscount ? 1 : (1 - ret));
  }

  // Station fee (paid per craft, not refunded), then per-unit by output count.
  const iv = (recipe.iv && (recipe.iv[String(ench)] ?? recipe.iv[ench])) || 0;
  const stationFee = Number(State.settings.stationFee) || 0;
  total += iv * 0.1125 * stationFee / 100;
  const outCount = refiningOutputCount(sheet, ench);
  if (outCount > 1) total /= outCount;

  return { cost: missing.length ? null : total, missing };
}

/** Public entry for refining cells. The cell number is ALWAYS the cost to
 *  refine the item yourself (so it reacts to Focus / return-rate settings).
 *  Returns { cost, mode, missing }, where mode is a buy-vs-refine flag:
 *    'M' = buying the finished item would be cheaper than refining it
 *    'C' = refining is the cheaper (or equal) option
 *    null = no market price entered for the item, so nothing to compare
 *  Market / Chain pricing modes just force how the ingredients are sourced. */
function refiningCellCost(sheet, recipe, ench) {
  const items = recipe.enchantments[String(ench)] || recipe.enchantments[ench];
  if (!items) return { cost: null, mode: null, missing: [] };
  const tier = Number((recipe.tierLabel.match(/(\d+)/) || [])[1] || 0);
  const mode = State.settings.pricingMode || 'auto';

  if (mode === 'market') {
    const r = refineCostWithMissing(sheet, recipe, tier, ench, 'market');
    return { cost: r.cost, mode: 'M', missing: r.cost == null ? r.missing : [] };
  }
  if (mode === 'chain') {
    const r = refineCostWithMissing(sheet, recipe, tier, ench, 'chain');
    return { cost: r.cost, mode: 'C', missing: r.cost == null ? r.missing : [] };
  }

  // Auto: always show the refine cost (cheapest ingredient sourcing). Default
  // the badge to 'C' (you're refining it) and only flip to 'M' when a market
  // price was entered for the item AND buying it is actually cheaper.
  const refine  = refineCostWithMissing(sheet, recipe, tier, ench, 'auto');
  const outId   = refinedOutputId(sheet, tier, ench);
  const buyCost = outId ? priceFor(outId) : null;
  if (refine.cost != null) {
    const flag = (buyCost != null && buyCost < refine.cost) ? 'M' : 'C';
    return { cost: refine.cost, mode: flag, missing: [] };
  }
  return { cost: null, mode: null, missing: refine.missing };
}

/** Compute total cost for one craft of a given recipe entry.
 *  Returns { cost, missing } where missing is array of mats with no price.
 *  Honors hearts flags:
 *    - heartGated: only counts when Use Hearts is on.
 *    - heartReducesQty: subtract 1 from qty when Use Hearts is on.
 *  - `batchDivisor` (e.g. 10 for soups, 5 for potions) divides the material
 *    cost only — station fee is not divided, matching the spreadsheet.
 *  - `iv` (Item Value) adds the station-fee component
 *    (iv * 0.1125 * stationFee / 100), outside the return-rate bracket. */
function computeRecipeCost(items, sheet, iv = 0, batchDivisor = 1) {
  const ret = returnFactor(sheet);
  const useHearts = !!State.settings.useHearts;
  let matTotal = 0;
  const missing = [];
  for (const it of items) {
    if (it.heartGated && !useHearts) continue;
    let qty = it.qty;
    if (it.heartReducesQty && useHearts) qty = Math.max(0, qty - 1);
    if (qty <= 0) continue;

    const price = priceFor(it.mat);
    if (price == null) {
      missing.push(it.mat);
      continue;
    }
    // Hearts and artifact items are outside the (1 - returnFactor) bracket
    // in the spreadsheet formula — they're not affected by return rate.
    const noDiscount = it.heartGated || it.noReturnDiscount;
    const factor = noDiscount ? 1 : (1 - ret);
    matTotal += qty * price * factor;
  }
  let total = batchDivisor > 0 ? matTotal / batchDivisor : matTotal;
  if (iv > 0) {
    total += iv * 0.1125 * (Number(State.settings.stationFee) || 0) / 100;
  }
  return { cost: total, missing };
}

// =============================================================================
// RENDERING — SIDEBAR
// =============================================================================
function renderSidebar() {
  const sb = document.getElementById('sidebar');
  const html = [];

  html.push(`<div class="nav-group">
    <div class="nav-group__title">General</div>
    <div class="nav-item ${State.view.type === 'home' ? 'active' : ''}" data-route="home">${navIcon('T4_FURNITUREITEM_GUILDBANNER_FABRIC')}Home</div>
    <div class="nav-item ${State.view.type === 'materials' ? 'active' : ''}" data-route="materials">${navIcon('T8_BAG')}Material Prices</div>
  </div>`);

  // Build group nav. Only show sheets that exist in data.
  const haveSheets = new Set(State.data.sheets);
  for (const grp of SHEET_GROUPS) {
    const sheets = grp.sheets.filter((s, i, a) => a.indexOf(s) === i && haveSheets.has(s));
    if (!sheets.length) continue;
    html.push(`<div class="nav-group"><div class="nav-group__title">${navIcon(grp.icon, 'sm')}${grp.title}</div>`);
    for (const sh of sheets) {
      const active = State.view.type === 'sheet' && State.view.sheet === sh ? 'active' : '';
      const label = SHEET_LABELS[sh] || sh;
      html.push(`<div class="nav-item ${active}" data-route="sheet" data-sheet="${sh}"><span class="nav-emoji nav-emoji--bullet">•</span>${label}</div>`);
    }
    html.push(`</div>`);
  }

  sb.innerHTML = html.join('');
  sb.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => {
      const route = el.dataset.route;
      if (route === 'sheet') {
        State.view = { type: 'sheet', sheet: el.dataset.sheet };
      } else {
        State.view = { type: route };
      }
      render();
    });
  });
}

// =============================================================================
// RENDERING — PAGES
// =============================================================================
function pageHome() {
  return `
    <div class="page-header">
      <h1 class="page-title">Welcome</h1>
      <p class="page-sub">Nendys' Official Crafting Calculator.</p>
    </div>

    <div class="panel">
      <h2 class="panel__title">Quick Start</h2>
      <ol style="margin:0;padding-left:18px;color:var(--text-2);font-size:13px;line-height:1.7;">
        <li>Open <strong>Material Prices</strong> and enter the buy-order prices you actually pay.</li>
        <li>Pick any category in the sidebar. Each page has a built-in <strong>Settings</strong> panel for return rate (Island / City / Bonus City / Hideout), bonuses, hearts and pricing mode.</li>
        <li>The cost per craft updates live for every tier &amp; enchantment as you tweak prices or settings.</li>
      </ol>
    </div>

    <div class="panel">
      <h2 class="panel__title">Jump to a category</h2>
      <div class="landing-grid">
        <div class="landing-card landing-card--mobile-only" data-go="materials">
          <img class="landing-card__icon" src="${iconUrl('T8_BAG', 96)}" alt="Material Prices" loading="lazy" data-hide-on-error />
          <h3>Material Prices</h3>
          <p>Enter buy prices</p>
        </div>
        ${SHEET_GROUPS.map(g => `
          <div class="landing-card" data-route="group" data-grp="${g.title}">
            <img class="landing-card__icon" src="${iconUrl(g.icon, 96)}" alt="${g.title}" loading="lazy" data-hide-on-error />
            <h3>${g.title}</h3>
            <p>${g.sheets.length} categor${g.sheets.length === 1 ? 'y' : 'ies'}</p>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/** Drill-in page reached from the home grid. Lists every sheet inside one
 *  category group as its own card so the user picks Plank Refining vs Steel
 *  Refining vs ... rather than landing straight on whichever sheet happens to
 *  be first in the list. */
function pageGroup(groupTitle) {
  const grp = SHEET_GROUPS.find(g => g.title === groupTitle);
  if (!grp) return pageHome();
  const haveSheets = new Set(State.data.sheets);
  const sheets = grp.sheets.filter((s, i, a) => a.indexOf(s) === i && haveSheets.has(s));
  const recipesBySheet = {};
  for (const r of (State.data.recipes || [])) {
    recipesBySheet[r.sheet] = (recipesBySheet[r.sheet] || 0) + 1;
  }

  const cards = sheets.map(sh => {
    const icon = previewIconForSheet(sh);
    const label = SHEET_LABELS[sh] || sh;
    const count = recipesBySheet[sh] || 0;
    const img = icon
      ? `<img class="landing-card__icon" src="${iconUrl(icon, 96)}" alt="${label}" loading="lazy" data-hide-on-error />`
      : '';
    return `
      <div class="landing-card" data-route="sheet" data-sheet="${sh}">
        ${img}
        <h3>${label}</h3>
        <p>${count} recipe${count === 1 ? '' : 's'}</p>
      </div>`;
  }).join('');

  return `
    <div class="page-header">
      <a href="#" class="back-link" data-go-home>← Home</a>
      <h1 class="page-title">${grp.title}</h1>
      <p class="page-sub">Pick a category</p>
    </div>
    <div class="panel">
      <div class="landing-grid">${cards}</div>
    </div>
  `;
}

/** Render the settings controls. When `compact` is true, returns one tight
 *  panel suitable for embedding at the top of a recipe page. The "Use Hearts"
 *  toggle is shown only on refining pages (or when no specific sheet is set,
 *  e.g. on the dedicated Settings page). */
function renderSettingsControls({ compact = false, sheet = null } = {}) {
  const s = State.settings;
  const showHearts = !sheet || REFINING_SHEETS.has(sheet);
  const heartsField = showHearts ? `
      <div class="field">
        <label>&nbsp;</label>
        <label class="toggle"><input type="checkbox" id="set-hearts" ${s.useHearts?'checked':''}/> Use Hearts</label>
      </div>` : '';
  // Pricing mode is refining-only: for each item, compare refining it yourself
  // against buying it from the market, and choose how to value the cell.
  const showPricing = !sheet || REFINING_SHEETS.has(sheet);
  const pricingField = showPricing ? `
      <div class="field">
        <label for="set-pricing">Pricing</label>
        <select id="set-pricing">
          <option value="auto"   ${s.pricingMode==='auto'  ?'selected':''}>Auto (cheapest)</option>
          <option value="market" ${s.pricingMode==='market'?'selected':''}>Market (buy materials)</option>
          <option value="chain"  ${s.pricingMode==='chain' ?'selected':''}>Chain (refine materials)</option>
        </select>
      </div>` : '';

  // Location label is context-aware: refining pages show 58%, crafting
  // pages show 33%, and the dedicated Settings page shows both.
  let bonusLabel = 'Bonus City (33% / 58% refining)';
  if (sheet) {
    bonusLabel = REFINING_SHEETS.has(sheet) ? 'Bonus City (58%)' : 'Bonus City (33%)';
  }

  const returnRateBlock = `
    <div class="settings-grid">
      <div class="field">
        <label for="set-location">Location</label>
        <select id="set-location">
          <option value="island"     ${s.location==='island'?'selected':''}>Island (0%)</option>
          <option value="city"       ${s.location==='city'?'selected':''}>City (18%)</option>
          <option value="bonusCity"  ${s.location==='bonusCity'?'selected':''}>${bonusLabel}</option>
          <option value="hideout"    ${s.location==='hideout'?'selected':''}>Hideout (custom)</option>
        </select>
      </div>
      <div class="field">
        <label for="set-day">Bonus Day</label>
        <select id="set-day">
          <option value="none" ${s.bonusDay==='none'?'selected':''}>None</option>
          <option value="b10"  ${s.bonusDay==='b10'?'selected':''}>+10%</option>
          <option value="b20"  ${s.bonusDay==='b20'?'selected':''}>+20%</option>
        </select>
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <label class="toggle"><input type="checkbox" id="set-focus" ${s.focus?'checked':''}/> Use Focus (+59%)</label>
      </div>
      <div class="field" id="hideout-field" style="${s.location==='hideout'?'':'display:none;'}">
        <label for="set-hideout">Hideout Return Rate (%)</label>
        <input type="number" id="set-hideout" min="0" max="100" step="0.1" value="${s.hideoutRate}" />
      </div>
      <div class="field">
        <label for="set-fee">Station Fee</label>
        <input type="text" inputmode="numeric" pattern="[0-9]*" id="set-fee" value="${s.stationFee}" autocomplete="off" />
      </div>
      ${heartsField}
      ${pricingField}
    </div>`;

  if (compact) {
    return `<div class="panel panel--settings">
      <h2 class="panel__title">Settings</h2>
      ${returnRateBlock}
    </div>`;
  }

  return `
    <div class="panel">
      <h2 class="panel__title">Return Rate</h2>
      ${returnRateBlock}
    </div>
    <div class="banner">
      <strong>Computed factor:</strong> with the current settings, you save
      <strong>${(returnFactor('Swords') * 100).toFixed(2)}%</strong> on crafting recipes and
      <strong>${(returnFactor('LeatherRefining') * 100).toFixed(2)}%</strong> on refining recipes.
    </div>`;
}

function pageSettings() {
  return `
    <div class="page-header">
      <h1 class="page-title">Settings</h1>
      <p class="page-sub">Return rate &amp; bonuses applied to every cost calculation. (These same controls are also embedded at the top of every recipe page.)</p>
    </div>
    ${renderSettingsControls({ compact: false })}
  `;
}

/** Wire change handlers on the settings controls. Whether the panel is on
 *  the dedicated Settings page or embedded on a sheet page, edits save and
 *  refresh the visible costs/stats — without a full re-render that would
 *  steal focus from active inputs. */
function bindSettingsHandlers() {
  const $ = id => document.getElementById(id);
  const apply = () => {
    if ($('set-location'))   State.settings.location   = $('set-location').value;
    if ($('set-day'))        State.settings.bonusDay   = $('set-day').value;
    if ($('set-focus'))      State.settings.focus      = $('set-focus').checked;
    if ($('set-hideout'))    State.settings.hideoutRate = Number($('set-hideout').value) || 0;
    if ($('set-fee'))        State.settings.stationFee = Number($('set-fee').value) || 0;
    if ($('set-hearts'))     State.settings.useHearts  = $('set-hearts').checked;
    if ($('set-pricing'))    State.settings.pricingMode = $('set-pricing').value;
    saveSettings();

    // Show / hide hideout input when location changes
    const hf = $('hideout-field');
    if (hf) hf.style.display = State.settings.location === 'hideout' ? '' : 'none';

    if (State.view.type === 'sheet') {
      // Update the rate-stats line and cost cells in place.
      const sheet = State.view.sheet;
      const ret = returnFactor(sheet);
      const isRefining = REFINING_SHEETS.has(sheet);
      const recipesLen = (State.data.recipes || []).filter(r => r.sheet === sheet).length;
      const stats = $('rate-stats');
      if (stats) {
        stats.innerHTML = `${recipesLen} recipes · effective return saved: ` +
          `<strong style="color:var(--accent)">${(ret*100).toFixed(2)}%</strong> · ` +
          `${isRefining ? 'refining bonus city = 58%' : 'crafting bonus city = 33%'}`;
      }
      updateSheetCosts();
    } else if (State.view.type === 'settings') {
      // Refresh the "computed factor" banner.
      const banners = document.querySelectorAll('.banner');
      banners.forEach(b => {
        if (b.textContent.includes('Computed factor')) {
          b.innerHTML = `<strong>Computed factor:</strong> with the current settings, you save
            <strong>${(returnFactor('Swords') * 100).toFixed(2)}%</strong> on crafting recipes and
            <strong>${(returnFactor('LeatherRefining') * 100).toFixed(2)}%</strong> on refining recipes.`;
        }
      });
    }
  };
  ['set-location','set-day','set-focus','set-hideout','set-fee','set-hearts','set-pricing']
    .forEach(id => { const el = $(id); if (el) el.addEventListener('change', apply); });
}

// =============================================================================
// MATERIALS PAGE
// =============================================================================
function pageMaterials() {
  // Group materials by family
  const byFamily = {};
  for (const m of State.data.materials) {
    (byFamily[m.family] ||= []).push(m);
  }
  // Order families: refined first, then raw, then food/potion, hearts, misc
  const order = ['PLANKS','STEEL','LEATHER','CLOTH','BLOCKS',
                 'LOGS','ORE','HIDE','FIBER','STONE',
                 'HEART','MISC','FOOD_POTION'];
  const families = order.filter(f => byFamily[f]);

  // Render tabs
  const groups = [
    { id: 'refined',  label: 'Refined', families: ['PLANKS','STEEL','LEATHER','CLOTH','BLOCKS'] },
    { id: 'raw',      label: 'Raw',     families: ['LOGS','ORE','HIDE','FIBER','STONE'] },
    { id: 'hearts',   label: 'Hearts',  families: ['HEART'] },
    { id: 'misc',     label: 'Misc',    families: ['MISC'] },
    { id: 'food',     label: 'Food / Potion', families: ['FOOD_POTION'] },
    { id: 'artifacts',label: 'Artifacts',     families: ['__ARTIFACTS__'] },
  ];

  const activeTab = State._matsTab || 'refined';
  const grp = groups.find(g => g.id === activeTab) || groups[0];

  let cards = '';
  if (grp.id === 'artifacts') {
    // Group all ARTIFACT_* families by sheet
    const bySheet = {};
    for (const m of State.data.materials) {
      if (m.kind === 'artifact') (bySheet[m.sheet] ||= []).push(m);
    }
    const sortedSheets = Object.keys(bySheet).sort((a, b) =>
      (SHEET_LABELS[a] || a).localeCompare(SHEET_LABELS[b] || b));
    for (const sheet of sortedSheets) {
      cards += renderArtifactCard(sheet, bySheet[sheet], { showSheetTitle: true });
    }
  } else if (grp.id === 'food') {
    // Group food/potion materials by their sub-category (CROPS, HERBS, MILK, etc.)
    // Fish (caught on the Food sheet itself) are folded into a single "FISH" card.
    const bySub = {};
    for (const m of (byFamily['FOOD_POTION'] || [])) {
      const sub = m.subFamily || 'OTHER';
      (bySub[sub] ||= []).push(m);
    }
    for (const m of (byFamily['FISH'] || [])) {
      (bySub['FISH'] ||= []).push(m);
    }
    // Preferred display order — common ingredients first, then enchant
    // catalysts (fish sauces / arcane extracts) since they're the next
    // thing a user fills in, then bait, then the rare boss-drop catalysts,
    // with the junk-drawer OTHER bucket at the very end.
    const order = [
      'CROPS', 'HERBS', 'FISH', 'MILK', 'BUTTER', 'EGGS', 'RAW MEAT', 'ANIMALS',
      'BREWING', 'WHEAT PRODUCTS', 'FLOUR',
      'FISH SAUCES', 'ARCANE EXTRACTS', 'BAIT INGREDIENTS',
      'SHADOW CLAWS', 'SYLVIAN ROOT', 'WEREWOLF FANGS', 'SPIRIT PAWS',
      'IMP\'S HORNS', 'RUNESTONE TOOTH', 'DAWNFEATHER',
      'OTHER ITEMS', 'OTHER',
    ];
    const seen = new Set(order);
    const subs = order.filter(s => bySub[s]).concat(
      Object.keys(bySub).filter(s => !seen.has(s))
    );
    for (const sub of subs) {
      const mats = bySub[sub].slice().sort((a, b) => {
        // Sort by the leading "TIER X" number when present
        const ta = (a.name.match(/TIER\s*(\d+)/i) || [])[1] || 0;
        const tb = (b.name.match(/TIER\s*(\d+)/i) || [])[1] || 0;
        return Number(ta) - Number(tb) || a.name.localeCompare(b.name);
      });
      cards += `<div class="mat-card"><h4>${sub}</h4>` +
        mats.map(m => `
          <div class="row">
            <label title="${m.id}">${m.name}</label>
            <input type="text" inputmode="numeric" pattern="[0-9]*" data-mat="${m.id}"
                   value="${State.prices[m.id] ?? ''}" placeholder="0" autocomplete="off" />
          </div>
        `).join('') +
        `</div>`;
    }
  } else {
    for (const fam of grp.families) {
      const mats = (byFamily[fam] || []).slice().sort(sortByTier);
      if (!mats.length) continue;
      cards += `<div class="mat-card"><h4>${fam}</h4>` +
        mats.map(m => `
          <div class="row">
            <label title="${m.id}">${m.name}</label>
            <input type="text" inputmode="numeric" pattern="[0-9]*" data-mat="${m.id}"
                   value="${State.prices[m.id] ?? ''}" placeholder="0" autocomplete="off" />
          </div>
        `).join('') +
        `</div>`;
    }
  }

  return `
    <div class="page-header">
      <h1 class="page-title">Material Prices</h1>
      <p class="page-sub">Enter the silver-per-unit you'd actually pay for each material. Saved automatically in your browser.</p>
    </div>

    <div class="tabs">
      ${groups.map(g => `<button class="tab ${g.id===activeTab?'active':''}" data-mtab="${g.id}">${g.label}</button>`).join('')}
    </div>

    <div class="mat-grid ${grp.id === 'food' ? 'mat-grid--masonry' : grp.id === 'artifacts' ? 'mat-grid--single' : ''}">${cards}</div>
  `;
}

/** Render a per-sheet artifact-price grid card.
 *  `mats` is an array of materials with kind='artifact' for this sheet. */
function renderArtifactCard(sheet, mats, { showSheetTitle = false } = {}) {
  if (!mats || !mats.length) return '';
  // Group by artifact base name (strip trailing " T4"-" T8")
  const byName = {};
  for (const m of mats) {
    const base = m.name.replace(/ T[1-8](\.\d)?$/, '');
    (byName[base] ||= []).push(m);
  }
  const tierLetters = ['T4','T5','T6','T7','T8'];
  const head = `<div class="art-grid__row art-grid__head">
    <span>Artifact</span>${tierLetters.map(t => `<span>${t}</span>`).join('')}
  </div>`;
  const rows = Object.keys(byName).map(name => {
    const tierMap = {};
    for (const m of byName[name]) tierMap[m.tier] = m;
    return `<div class="art-grid__row">
      <span class="art-grid__name" title="${name}">${name}</span>` +
      tierLetters.map(t => {
        const m = tierMap[t];
        return m
          ? `<input type="text" inputmode="numeric" pattern="[0-9]*" data-mat="${m.id}" value="${State.prices[m.id] ?? ''}" placeholder="0" autocomplete="off" />`
          : `<span class="muted">—</span>`;
      }).join('') +
      `</div>`;
  }).join('');
  const title = showSheetTitle ? `<h4>${SHEET_LABELS[sheet] || sheet}</h4>` : `<h4>Artifacts</h4>`;
  const widthStyle = showSheetTitle ? 'grid-column: 1 / -1;' : '';
  return `<div class="mat-card" style="${widthStyle}">${title}<div class="art-grid">${head}${rows}</div></div>`;
}

function sortByTier(a, b) {
  const pa = parseTier(a.tier), pb = parseTier(b.tier);
  return pa - pb;
}
function parseTier(t) {
  if (!t || t === '-') return 0;
  const m = String(t).match(/(\d+)(?:\.(\d+))?/);
  if (!m) return 0;
  return Number(m[1]) * 10 + Number(m[2] || 0);
}

/** Wire artifact-price inputs on a sheet page. Edits save and re-render the
 *  recipe table so costs update live, but we keep focus on the input being
 *  edited so typing isn't interrupted. */
function bindSheetHandlers() {
  document.querySelectorAll('input[data-mat]').forEach(inp => {
    inp.addEventListener('input', () => {
      const id = inp.dataset.mat;
      const v = inp.value;
      if (v === '') delete State.prices[id]; else State.prices[id] = Number(v);
      savePrices();
      // Update only the recipe table cells (avoid re-rendering inputs which kills focus)
      updateSheetCosts();
    });
  });
  // "Material Prices" link in the missing-prices banner -> jump to the
  // materials page, pre-selecting the most relevant tab.
  document.querySelectorAll('[data-go-materials]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const tab = a.dataset.mtab;
      if (tab) State._matsTab = tab;
      State.view = { type: 'materials' };
      render();
    });
  });
}

/** Recompute and rewrite recipe cost cells without disturbing input focus. */
function updateSheetCosts() {
  if (State.view.type !== 'sheet') return;
  const sheet = State.view.sheet;
  const isRefining = REFINING_SHEETS.has(sheet);
  // Chain cost cache must be cleared whenever prices/settings change.
  if (typeof clearChainCache === 'function') clearChainCache();
  const recipes = (State.data.recipes || []).filter(r => r.sheet === sheet);
  // Rows are rendered grouped by section (see pageSheet), but the raw recipe
  // order can interleave sections by tier (e.g. gathering gear: Rod, Cap,
  // Garb, ... Rod again). We must walk recipes in the SAME grouped order the
  // table was built with, or the positional row↔recipe mapping below is wrong
  // and we'd write each recipe's cost into the wrong row.
  const sections = {};
  for (const r of recipes) {
    const key = r.section || '—';
    (sections[key] ||= []).push(r);
  }
  const ordered = [];
  for (const name of Object.keys(sections)) ordered.push(...sections[name]);
  // Determine enchant column count from first recipe
  let maxEnch = 0;
  for (const r of recipes) {
    for (const k of Object.keys(r.enchantments)) maxEnch = Math.max(maxEnch, Number(k));
  }
  const tbody = document.querySelector('.tbl tbody');
  if (!tbody) return;
  // Every <tr> in the recipe table corresponds to one (item, tier) pair.
  const rows = Array.from(tbody.children);
  let i = 0;
  for (const r of ordered) {
    const tr = rows[i++];
    if (!tr) continue;
    const cells = tr.querySelectorAll('td.price-cell');
    let ci = 0;
    for (let e = 0; e <= maxEnch; e++) {
      const cell = cells[ci++];
      if (!cell) continue;
      const items = r.enchantments[String(e)] || r.enchantments[e];
      if (!items) { cell.textContent = '—'; cell.className = 'price-cell muted'; continue; }
      if (isRefining) {
        const { cost, mode } = refiningCellCost(sheet, r, e);
        if (cost == null) { cell.textContent = 'no price'; cell.className = 'price-cell muted'; continue; }
        cell.innerHTML = formatSilver(cost) + badgeFor(mode);
        cell.className = 'price-cell';
        continue;
      }
      const iv    = (r.iv && (r.iv[String(e)] ?? r.iv[e])) || 0;
      const batch = (r.batch     && (r.batch[String(e)]     ?? r.batch[e]))     || 1;
      const { cost, missing } = computeRecipeCost(items, sheet, iv, batch);
      if (missing.length === items.length) { cell.textContent = 'no price'; cell.className = 'price-cell muted'; continue; }
      cell.textContent = formatSilver(cost);
      cell.className = 'price-cell';
    }
  }
}

function bindMaterialsHandlers() {
  document.querySelectorAll('.tab[data-mtab]').forEach(btn => {
    btn.addEventListener('click', () => { State._matsTab = btn.dataset.mtab; render(); });
  });
  document.querySelectorAll('input[data-mat]').forEach(inp => {
    inp.addEventListener('input', () => {
      const id = inp.dataset.mat;
      const v = inp.value;
      if (v === '') delete State.prices[id]; else State.prices[id] = Number(v);
      savePrices();
    });
  });
}

// =============================================================================
// SHEET (RECIPE) PAGE
// =============================================================================
function pageSheet(sheet) {
  const recipes = (State.data.recipes || []).filter(r => r.sheet === sheet);
  if (!recipes.length) {
    return `<div class="page-header"><h1 class="page-title">${SHEET_LABELS[sheet] || sheet}</h1></div>
            <div class="panel"><p style="color:var(--text-3);margin:0;">No recipes available for this sheet.</p></div>`;
  }

  const ret = returnFactor(sheet);
  const isRefining = REFINING_SHEETS.has(sheet);

  // Group by section (e.g. "Broadsword", "Soups", "Salads")
  const sections = {};
  for (const r of recipes) {
    const key = r.section || '—';
    (sections[key] ||= []).push(r);
  }

  // Determine max enchant level present
  let maxEnch = 0;
  for (const r of recipes) {
    for (const k of Object.keys(r.enchantments)) maxEnch = Math.max(maxEnch, Number(k));
  }
  const enchCols = [];
  for (let e = 0; e <= maxEnch; e++) enchCols.push(e);

  let body = '';
  let totalMissing = new Set();
  const sheetIcons = State.icons[sheet] || {};

  for (const sectionName of Object.keys(sections)) {
    const recs = sections[sectionName];
    const span = recs.length;
    const itemId = sheetIcons[sectionName];
    const imgHtml = itemId
      ? `<img class="item-icon" src="${iconUrl(itemId, 96)}" alt="${sectionName}" loading="lazy" data-hide-on-error />`
      : '';
    const itemCellHtml = `<td class="item-name item-name--merged" rowspan="${span}">
        ${imgHtml}<div class="item-label">${sectionName}</div>
      </td>`;

    recs.forEach((r, i) => {
      const cells = enchCols.map(e => {
        const items = r.enchantments[String(e)] || r.enchantments[e];
        if (!items) return `<td class="price-cell muted">—</td>`;
        if (isRefining) {
          const { cost, mode, missing } = refiningCellCost(sheet, r, e);
          missing.forEach(m => totalMissing.add(m));
          if (cost == null) return `<td class="price-cell muted">no price</td>`;
          return `<td class="price-cell" data-ench="${e}">${formatSilver(cost)}${badgeFor(mode)}</td>`;
        }
        const iv    = (r.iv    && (r.iv[String(e)]    ?? r.iv[e]))    || 0;
        const batch = (r.batch && (r.batch[String(e)] ?? r.batch[e])) || 1;
        const { cost, missing } = computeRecipeCost(items, sheet, iv, batch);
        missing.forEach(m => totalMissing.add(m));
        if (missing.length === items.length) return `<td class="price-cell muted">no price</td>`;
        return `<td class="price-cell" data-ench="${e}">${formatSilver(cost)}</td>`;
      }).join('');
      // Only the FIRST tier-row of a section gets the merged item cell.
      // Tag the first / last rows so CSS can space sections apart.
      const rowClasses = [
        i === 0 ? 'section-start' : '',
        i === recs.length - 1 ? 'section-end' : '',
      ].filter(Boolean).join(' ');
      body += `<tr${rowClasses ? ` class="${rowClasses}"` : ''}>
        ${i === 0 ? itemCellHtml : ''}
        <td class="tier-cell">${r.tierLabel}</td>
        ${cells}
      </tr>`;
    });
  }

  const head = `
    <thead><tr>
      <th>Item</th>
      <th>Tier</th>
      ${enchCols.map(e => `<th class="ench-th">${enchHeaderLabel(sheet, e)}</th>`).join('')}
    </tr></thead>`;

  // Pick the materials tab most relevant to the missing IDs, so the link
  // jumps straight to the right card. (FISH_* -> food, ART_* -> artifacts,
  // FP_* -> food, HEART_* -> hearts, MISC_* -> misc, otherwise refined/raw.)
  let tabHint = 'refined';
  for (const id of totalMissing) {
    if (id.startsWith('ART_'))   { tabHint = 'artifacts'; break; }
    if (id.startsWith('FISH_'))  { tabHint = 'food';      break; }
    if (id.startsWith('FP_'))    { tabHint = 'food';      break; }
    if (id.startsWith('HEART_')) { tabHint = 'hearts';    break; }
    if (id.startsWith('MISC_'))  { tabHint = 'misc';      break; }
    if (/^(LOGS|ORE|HIDE|FIBER|STONE)_/.test(id)) { tabHint = 'raw'; break; }
  }

  const missingNote = totalMissing.size
    ? `<div class="banner">${DANGER_ICON}${totalMissing.size} material price${totalMissing.size>1?'s are':' is'} missing — open
        <a href="#" class="banner__link" data-go-materials data-mtab="${tabHint}">Material Prices</a>
        to fill them in.</div>`
    : '';

  // Artifact-price grid for this sheet (if any artifacts are defined for it).
  const sheetArtifacts = (State.data.materials || []).filter(m => m.kind === 'artifact' && m.sheet === sheet);
  const artBlock = sheetArtifacts.length ? `
    <div class="panel">
      <h2 class="panel__title">Artifact Prices</h2>
      <div class="mat-grid mat-grid--single">${renderArtifactCard(sheet, sheetArtifacts)}</div>
    </div>` : '';

  // Refining pages get a hero image of the T8 refined material above the
  // title and an explanatory caption below the table.
  const heroIcon = isRefining && REFINING_HERO_ICON[sheet];
  const heroBlock = heroIcon
    ? `<img class="page-hero-icon" src="${iconUrl(heroIcon, 128)}" alt="${SHEET_LABELS[sheet] || sheet}" loading="lazy" data-hide-on-error />`
    : '';
  const refiningCaption = isRefining ? `
    <div class="page-caption">
      Each number is your cost to <strong>refine that item</strong> (it reacts to your Focus &amp;
      return-rate settings). The badge:<br>
      <span class="cost-badge cost-badge--c" style="margin: 0 4px 0 0;">C</span> cheaper to <strong>refine</strong> it yourself<br>
      <span class="cost-badge cost-badge--m" style="margin: 0 4px 0 0;">M</span> cheaper to <strong>buy</strong> it from the market (market price you entered is lower)
    </div>` : '';

  return `
    <div class="page-header ${isRefining ? 'page-header--with-hero' : ''}">
      ${heroBlock}
      <div>
        <h1 class="page-title">${SHEET_LABELS[sheet] || sheet}</h1>
        <p class="page-sub" id="rate-stats">${recipes.length} recipes · effective return saved: <strong style="color:var(--accent)">${(ret*100).toFixed(2)}%</strong> · ${isRefining ? 'refining bonus city = 58%' : 'crafting bonus city = 33%'}</p>
      </div>
    </div>
    ${renderSettingsControls({ compact: true, sheet })}
    ${missingNote}
    ${artBlock}
    <div class="panel" style="padding:0;">
      <div class="tbl-wrap">
        <table class="tbl ${isRefining ? 'tbl--refining' : ''}">${head}<tbody>${body}</tbody></table>
      </div>
    </div>
    ${refiningCaption}
  `;
}

/** Display name with the trailing tier removed.
 *  "Bow Tier 1" -> "Bow"  /  "Harvester Cap Tier 4" -> "Harvester Cap"
 *  Leaves names alone when the tier doesn't appear as a suffix
 *  (e.g. "Carrot Soup T1" — the tier IS the item name in Food). */
function stripTierFromItem(r) {
  if (!r.tierLabel) return r.item;
  const suffix = ' ' + r.tierLabel;
  if (r.item.endsWith(suffix)) {
    return r.item.slice(0, -suffix.length).trim();
  }
  return r.item;
}

/** Render a small M / C badge next to a refining cost. Returns '' when
 *  Pricing mode is forced (Market only / Chain only) so the badge would be
 *  redundant with the dropdown. */
function badgeFor(mode) {
  if (!mode) return '';
  if ((State.settings.pricingMode || 'auto') !== 'auto') return '';
  return ` <span class="cost-badge cost-badge--${mode.toLowerCase()}">${mode}</span>`;
}

function formatSilver(n) {
  if (!isFinite(n) || n === 0) return '0';
  // Show without decimals; use comma separators
  return Math.round(n).toLocaleString('en-US');
}

// =============================================================================
// MAIN RENDER
// =============================================================================
function render() {
  renderSidebar();
  const main = document.getElementById('main');
  let html;
  switch (State.view.type) {
    case 'materials': html = pageMaterials(); break;
    case 'sheet':     html = pageSheet(State.view.sheet); break;
    case 'group':     html = pageGroup(State.view.group); break;
    // 'settings' was a dedicated page; controls are now embedded on
    // every recipe page so the sidebar entry is gone. Anyone landing
    // here (saved view, etc.) falls through to the home page.
    case 'settings':  State.view = { type: 'home' }; /* fallthrough */
    default:          html = pageHome();
  }
  main.innerHTML = html;
  updateHomeFab();   // hides on home, shows everywhere else

  // Bind page-specific handlers
  if (State.view.type === 'settings')   bindSettingsHandlers();
  if (State.view.type === 'materials')  bindMaterialsHandlers();
  if (State.view.type === 'sheet')    { bindSheetHandlers(); bindSettingsHandlers(); }
  if (State.view.type === 'home') {
    document.querySelectorAll('.landing-card[data-grp]').forEach(card => {
      card.addEventListener('click', () => {
        State.view = { type: 'group', group: card.dataset.grp };
        render();
      });
    });
    // "Material Prices" quick-access card (the one nav target not reachable
    // via the category cards, important now the sidebar is hidden on phones).
    document.querySelectorAll('.landing-card[data-go="materials"]').forEach(card => {
      card.addEventListener('click', () => {
        State.view = { type: 'materials' };
        render();
      });
    });
  }
  if (State.view.type === 'group') {
    // Sheet cards inside a group page → navigate to that sheet.
    document.querySelectorAll('.landing-card[data-sheet]').forEach(card => {
      card.addEventListener('click', () => {
        State.view = { type: 'sheet', sheet: card.dataset.sheet };
        render();
      });
    });
    // "← Home" link
    document.querySelectorAll('[data-go-home]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        State.view = { type: 'home' };
        render();
      });
    });
  }
}

// =============================================================================
// TOPBAR ACTIONS
// =============================================================================
function bindTopbar() {
  // Floating Home button on the right edge — returns to the landing page.
  const homeFab = document.getElementById('homeFab');
  if (homeFab) homeFab.addEventListener('click', () => {
    State.view = { type: 'home' };
    render();
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    if (!confirm('Reset all stored prices and settings?')) return;
    State.prices = {};
    State.settings = {
      location: 'city', bonusDay: 'none', focus: false,
      hideoutRate: 50, stationFee: 1000, useHearts: false,
    };
    savePrices(); saveSettings();
    render();
  });
}

// =============================================================================
// LOGIN OVERLAY
// =============================================================================
function showLogin() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.hidden = false;
  initCaptcha();   // lazy-load the CAPTCHA widget the first time login is shown
  // Hide app chrome bits while not authed
  toggleAppChrome(false);
}
function hideLogin() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.hidden = true;
  toggleAppChrome(true);
}
function toggleAppChrome(loggedIn) {
  const ids = ['logoutBtn', 'current-user', 'resetBtn'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.hidden = !loggedIn;
  }
  updateHomeFab(loggedIn);
}

/** Show the floating Home button only when (a) logged in, and
 *  (b) NOT already on the home page. Called by render() too. */
function updateHomeFab(loggedIn = !!State.user) {
  const fab = document.getElementById('homeFab');
  if (!fab) return;
  const onHome = State.view.type === 'home';
  fab.hidden = !loggedIn || onHome;
}

// =============================================================================
// CAPTCHA (Cloudflare Turnstile)
// Active only when TURNSTILE_SITE_KEY is set in config.js. The script is loaded
// lazily the first time the login form is shown, and an explicit widget is
// rendered into #login-captcha. The resulting token is passed to
// signInWithPassword; Supabase verifies it server-side when CAPTCHA protection
// is enabled for the project. When the key is empty, login works without it.
// =============================================================================
let captchaToken       = '';
let captchaWidgetId    = null;
let captchaInitStarted = false;

function captchaEnabled() {
  return !!(window.NENDYS_CONFIG && window.NENDYS_CONFIG.TURNSTILE_SITE_KEY);
}

/** Lazy-load Turnstile and render the widget. Idempotent; no-op when disabled. */
function initCaptcha() {
  if (captchaInitStarted || !captchaEnabled()) return;
  captchaInitStarted = true;

  // Called by the Turnstile script once it loads (explicit render mode).
  window.onTurnstileReady = () => {
    const el = document.getElementById('login-captcha');
    if (!el || !window.turnstile) return;
    captchaWidgetId = window.turnstile.render(el, {
      sitekey: window.NENDYS_CONFIG.TURNSTILE_SITE_KEY,
      callback:           (token) => { captchaToken = token; },
      'expired-callback': ()      => { captchaToken = ''; },
      'error-callback':   ()      => { captchaToken = ''; },
    });
  };

  const s = document.createElement('script');
  s.src   = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileReady';
  s.async = true;
  s.defer = true;
  document.head.appendChild(s);
}

/** Reset the widget after a sign-in attempt — Turnstile tokens are single-use. */
function resetCaptcha() {
  captchaToken = '';
  if (captchaWidgetId !== null && window.turnstile) {
    try { window.turnstile.reset(captchaWidgetId); } catch (_) { /* ignore */ }
  }
}

function bindLoginForm() {
  const form  = document.getElementById('login-form');
  const err   = document.getElementById('login-error');
  const btn   = document.getElementById('login-submit');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;

    if (captchaEnabled() && !captchaToken) {
      err.textContent = 'Please complete the human-verification check below.';
      err.hidden = false;
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Signing in…';
    const email    = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const { user, error } = await NendysAuth.signIn(email, password, captchaToken);
    btn.disabled = false;
    btn.textContent = 'Sign In';
    if (error) {
      err.textContent = error;
      err.hidden = false;
      resetCaptcha();   // token is single-use; issue a fresh one for the retry
      return;
    }
    // onChange listener will pick up the new session and finish the boot.
  });
}

function bindLogout() {
  const btn = document.getElementById('logoutBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!confirm('Sign out?')) return;
    // Flush any pending writes before we lose the session
    if (window.NendysSync) await NendysSync.flush(State.prices, State.settings);
    await NendysAuth.signOut();
    location.reload();
  });
}

/** Initialize the calculator app once the user is known to be signed in.
 *  Idempotent — safe to call on every auth-state change to a logged-in user. */
let appInitialized = false;
async function initAppForUser(user) {
  State.user = user;
  const userLabel = document.getElementById('current-user');
  if (userLabel) userLabel.textContent = user.email || 'Signed in';

  // Recipe data is gated behind auth — load it (once per session) from the
  // private `recipe-data` bucket now that we have a signed-in session. It is
  // cached client-side by version, so this is a no-network no-op on revisits.
  if (!State.data) {
    document.getElementById('main').innerHTML = '<div class="loading">Loading recipe data…</div>';
    try {
      const [data, icons] = await Promise.all([
        NendysData.loadJSON('data.json'),
        NendysData.loadJSON('icons.json').catch(() => ({})),
      ]);
      State.data  = data;
      State.icons = icons || {};
    } catch (err) {
      document.getElementById('main').innerHTML =
        `<div class="panel"><p style="color:var(--bad)">Failed to load recipe data: ${err.message}</p></div>`;
      return;
    }
  }

  // Pull the user's stored prices & settings from Supabase, falling back to
  // anything in localStorage if the cloud row is empty / unreachable.
  try {
    const cloud = await NendysSync.load();
    if (cloud) {
      const cleanPrices = sanitizePrices(cloud.prices || {});
      if (Object.keys(cleanPrices).length) {
        State.prices = cleanPrices;
        localStorage.setItem(PRICES_KEY, JSON.stringify(State.prices));
      }
      const cleanSettings = sanitizeSettings(cloud.settings || {});
      if (Object.keys(cleanSettings).length) {
        Object.assign(State.settings, cleanSettings);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings: State.settings }));
      }
    }
  } catch (e) {
    console.warn('Cloud load failed, using local cache:', e);
  }

  hideLogin();

  if (appInitialized) {
    render();
    return;
  }
  appInitialized = true;
  bindTopbar();
  render();
}

// =============================================================================
// BOOT
// =============================================================================
async function boot() {
  document.getElementById('main').innerHTML = '<div class="loading">Loading…</div>';
  loadStored();
  bindLoginForm();
  bindLogout();

  // Recipe data now lives in a private, auth-gated bucket, so the app cannot
  // load anything meaningful without Supabase configured. (The data fetch
  // itself happens in initAppForUser, after sign-in.)
  if (!window.NendysAuth || !NendysAuth.isConfigured) {
    console.warn('[Nendys] Supabase not configured. Edit albion/config.js.');
    document.getElementById('main').innerHTML =
      `<div class="panel" style="border-color: var(--warn);">
         <h2 class="panel__title" style="color: var(--warn);">Auth not configured</h2>
         <p style="color: var(--text-2); margin: 0; line-height: 1.6;">
           This deployment is missing Supabase credentials. Edit
           <code style="color: var(--accent);">albion/config.js</code> with your
           project URL and anon key, then redeploy.
         </p>
       </div>`;
    return;
  }

  // Watch for sign-in / sign-out
  NendysAuth.onChange(user => {
    if (user) { initAppForUser(user); }
    else      { State.user = null; appInitialized = false; showLogin(); }
  });

  // Initial check — already signed in?
  const user = await NendysAuth.getUser();
  if (user) initAppForUser(user);
  else      showLogin();
  return;
}

boot();
