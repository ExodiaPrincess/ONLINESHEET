/* ============================================================================
   Nendys Calculator — Albion Online crafting/refining/food/potion calculator.
   Replicates the core formulas of the Nendys V2 spreadsheet.
   ============================================================================ */

const STORAGE_KEY = 'nendys.v2';
const PRICES_KEY  = 'nendys.prices';

// Bonus city return rate per sheet group. Refining uses 58 (real Albion 58.5%
// bonus city), everything else uses 33 (33.5% crafting bonus).
const REFINING_SHEETS = new Set([
  'LeatherRefining', 'StoneRefining', 'PlankRefining', 'SteelRefining', 'ClothRefining',
]);

// Grouping for the sidebar — which sheets fall under which collapsible group.
const SHEET_GROUPS = [
  { title: 'Refining', emoji: '🔥', sheets: [
    'PlankRefining', 'SteelRefining', 'LeatherRefining', 'ClothRefining', 'StoneRefining',
  ]},
  { title: 'Weapons · Warrior', emoji: '⚔️', sheets: [
    'Swords', 'Axes', 'Maces', 'Hammers', 'Quarterstaffs', 'Spears',
  ]},
  { title: 'Weapons · Hunter', emoji: '🏹', sheets: [
    'Bows', 'Crossbows', 'Daggers', 'Spears',
  ]},
  { title: 'Weapons · Mage', emoji: '🔮', sheets: [
    'CursedStaff', 'FrostStaff', 'ArcaneStaff', 'HolyStaffs', 'FireStaff', 'NatureStaff',
  ]},
  { title: 'Off-hands', emoji: '🛡️', sheets: [
    'Shields', 'Tomes', 'Torch',
  ]},
  { title: 'Armor · Plate', emoji: '🪖', sheets: [
    'PlateHelmets', 'PlateArmors', 'PlateBoots',
  ]},
  { title: 'Armor · Leather', emoji: '🥋', sheets: [
    'LeatherHoods', 'LeatherJackets', 'LeatherShoes',
  ]},
  { title: 'Armor · Cloth', emoji: '👘', sheets: [
    'ClothCowls', 'ClothRobes', 'ClothSandals',
  ]},
  { title: 'Accessories', emoji: '🎒', sheets: [
    'BagsSatchelsTracking', 'CapesFurniture', 'Gloves', 'ShapeShifters',
  ]},
  { title: 'Gathering Gear', emoji: '⛏️', sheets: [
    'GatheringGear',
  ]},
  { title: 'Consumables', emoji: '🥘', sheets: [
    'Food', 'Potions',
  ]},
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
  CapesFurniture: 'Capes & Furniture',
  ShapeShifters: 'Shapeshifter Staves',
  GatheringGear: 'Gathering Gear',
};

// =============================================================================
// STATE
// =============================================================================
const State = {
  data: null,            // loaded from data.json
  prices: {},            // mat_id -> price (number)
  settings: {
    location: 'city',         // island | city | bonusCity | hideout
    bonusDay: 'none',         // none | b10 | b20
    focus: false,
    hideoutRate: 50,          // % when location=hideout
    stationFee: 1000,         // for food/potions
    useHearts: false,         // for refining T4+
  },
  view: { type: 'home', sheet: null },
};

// =============================================================================
// PERSISTENCE
// =============================================================================
function loadStored() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    Object.assign(State.settings, s.settings || {});
  } catch {}
  try {
    State.prices = JSON.parse(localStorage.getItem(PRICES_KEY) || '{}');
  } catch { State.prices = {}; }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings: State.settings }));
}
function savePrices() {
  localStorage.setItem(PRICES_KEY, JSON.stringify(State.prices));
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

/** Compute total cost for one craft of a given recipe entry.
 *  Returns { cost, missing } where missing is array of mats with no price.
 *  Honors hearts flags:
 *    - heartGated: only counts when Use Hearts is on.
 *    - heartReducesQty: subtract 1 from qty when Use Hearts is on.
 *  - `batchDivisor` (e.g. 10 for soups, 5 for potions) divides the material
 *    cost only — station fee is not divided, matching the spreadsheet.
 *  - `nutritionCost` adds the station-fee component
 *    (nutrition * 0.1125 * stationFee / 100), outside the return-rate bracket. */
function computeRecipeCost(items, sheet, nutritionCost = 0, batchDivisor = 1) {
  const ret = returnFactor(sheet);
  const useHearts = !!State.settings.useHearts;
  let matTotal = 0;
  const missing = [];
  for (const it of items) {
    if (it.heartGated && !useHearts) continue;
    let qty = it.qty;
    if (it.heartReducesQty && useHearts) qty = Math.max(0, qty - 1);
    if (qty <= 0) continue;

    const price = State.prices[it.mat];
    if (price === undefined || price === null || price === '' || isNaN(price)) {
      missing.push(it.mat);
      continue;
    }
    // Hearts and artifact items are outside the (1 - returnFactor) bracket
    // in the spreadsheet formula — they're not affected by return rate.
    const noDiscount = it.heartGated || it.noReturnDiscount;
    const factor = noDiscount ? 1 : (1 - ret);
    matTotal += qty * Number(price) * factor;
  }
  let total = batchDivisor > 0 ? matTotal / batchDivisor : matTotal;
  if (nutritionCost > 0) {
    total += nutritionCost * 0.1125 * (Number(State.settings.stationFee) || 0) / 100;
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
    <div class="nav-item ${State.view.type === 'home' ? 'active' : ''}" data-route="home"><span class="nav-emoji">🏠</span>Home</div>
    <div class="nav-item ${State.view.type === 'materials' ? 'active' : ''}" data-route="materials"><span class="nav-emoji">📦</span>Material Prices</div>
    <div class="nav-item ${State.view.type === 'settings' ? 'active' : ''}" data-route="settings"><span class="nav-emoji">⚙️</span>Settings</div>
  </div>`);

  // Build group nav. Only show sheets that exist in data.
  const haveSheets = new Set(State.data.sheets);
  for (const grp of SHEET_GROUPS) {
    const sheets = grp.sheets.filter((s, i, a) => a.indexOf(s) === i && haveSheets.has(s));
    if (!sheets.length) continue;
    html.push(`<div class="nav-group"><div class="nav-group__title">${grp.emoji} ${grp.title}</div>`);
    for (const sh of sheets) {
      const active = State.view.type === 'sheet' && State.view.sheet === sh ? 'active' : '';
      const label = SHEET_LABELS[sh] || sh;
      html.push(`<div class="nav-item ${active}" data-route="sheet" data-sheet="${sh}"><span class="nav-emoji">•</span>${label}</div>`);
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
      <p class="page-sub">A web replica of the Nendys V2 Albion crafting calculator. Enter prices once, then browse any category.</p>
    </div>

    <div class="panel">
      <h2 class="panel__title">Quick Start</h2>
      <ol style="margin:0;padding-left:18px;color:var(--text-2);font-size:13px;line-height:1.7;">
        <li>Open <strong>Material Prices</strong> and enter the buy-order prices you actually pay.</li>
        <li>Open <strong>Settings</strong> and pick your return rate (Island / City / Bonus City / Hideout) and any bonuses.</li>
        <li>Open any category in the sidebar to see the calculated cost per craft for every tier &amp; enchantment.</li>
      </ol>
    </div>

    <div class="panel">
      <h2 class="panel__title">Jump to a category</h2>
      <div class="landing-grid">
        ${SHEET_GROUPS.map(g => `
          <div class="landing-card" data-route="group" data-grp="${g.title}">
            <div class="emo">${g.emoji}</div>
            <h3>${g.title}</h3>
            <p>${g.sheets.length} categor${g.sheets.length === 1 ? 'y' : 'ies'}</p>
          </div>
        `).join('')}
      </div>
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
  const returnRateBlock = `
    <div class="settings-grid">
      <div class="field">
        <label for="set-location">Location</label>
        <select id="set-location">
          <option value="island"     ${s.location==='island'?'selected':''}>Island (0%)</option>
          <option value="city"       ${s.location==='city'?'selected':''}>City (18%)</option>
          <option value="bonusCity"  ${s.location==='bonusCity'?'selected':''}>Bonus City (33% / 58% refining)</option>
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
        <input type="number" id="set-fee" min="0" step="1" value="${s.stationFee}" />
      </div>
      ${heartsField}
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
  ['set-location','set-day','set-focus','set-hideout','set-fee','set-hearts']
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
    const bySub = {};
    for (const m of (byFamily['FOOD_POTION'] || [])) {
      const sub = m.subFamily || 'OTHER';
      (bySub[sub] ||= []).push(m);
    }
    // Preferred display order — common ingredients first, harvested artifacts last
    const order = [
      'CROPS', 'HERBS', 'MILK', 'BUTTER', 'EGGS', 'RAW MEAT', 'ANIMALS',
      'BREWING', 'WHEAT PRODUCTS', 'FLOUR',
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
            <input type="number" min="0" step="1" data-mat="${m.id}"
                   value="${State.prices[m.id] ?? ''}" placeholder="0" />
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
            <input type="number" min="0" step="1" data-mat="${m.id}"
                   value="${State.prices[m.id] ?? ''}" placeholder="0" />
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

    <div class="mat-grid">${cards}</div>
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
          ? `<input type="number" min="0" step="1" data-mat="${m.id}" value="${State.prices[m.id] ?? ''}" placeholder="0" />`
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
}

/** Recompute and rewrite recipe cost cells without disturbing input focus. */
function updateSheetCosts() {
  if (State.view.type !== 'sheet') return;
  const sheet = State.view.sheet;
  const recipes = (State.data.recipes || []).filter(r => r.sheet === sheet);
  // Determine enchant column count from first recipe
  let maxEnch = 0;
  for (const r of recipes) {
    for (const k of Object.keys(r.enchantments)) maxEnch = Math.max(maxEnch, Number(k));
  }
  const tbody = document.querySelector('.tbl tbody');
  if (!tbody) return;
  const rows = Array.from(tbody.children).filter(tr => !tr.classList.contains('group-row'));
  let i = 0;
  for (const r of recipes) {
    const tr = rows[i++];
    if (!tr) continue;
    const cells = tr.querySelectorAll('td.price-cell');
    let ci = 0;
    for (let e = 0; e <= maxEnch; e++) {
      const cell = cells[ci++];
      if (!cell) continue;
      const items = r.enchantments[String(e)] || r.enchantments[e];
      if (!items) { cell.textContent = '—'; cell.className = 'price-cell muted'; continue; }
      const nut   = (r.nutrition && (r.nutrition[String(e)] ?? r.nutrition[e])) || 0;
      const batch = (r.batch     && (r.batch[String(e)]     ?? r.batch[e]))     || 1;
      const { cost, missing } = computeRecipeCost(items, sheet, nut, batch);
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

  for (const sectionName of Object.keys(sections)) {
    body += `<tr class="group-row"><td colspan="${enchCols.length + 2}">${sectionName}</td></tr>`;
    for (const r of sections[sectionName]) {
      const cells = enchCols.map(e => {
        const items = r.enchantments[String(e)] || r.enchantments[e];
        if (!items) return `<td class="price-cell muted">—</td>`;
        const nut   = (r.nutrition && (r.nutrition[String(e)] ?? r.nutrition[e])) || 0;
        const batch = (r.batch     && (r.batch[String(e)]     ?? r.batch[e]))     || 1;
        const { cost, missing } = computeRecipeCost(items, sheet, nut, batch);
        missing.forEach(m => totalMissing.add(m));
        if (missing.length === items.length) return `<td class="price-cell muted">no price</td>`;
        return `<td class="price-cell">${formatSilver(cost)}</td>`;
      }).join('');
      const itemName = stripTierFromItem(r);
      body += `<tr>
        <td class="item-name">${itemName}</td>
        <td class="tier-cell">${r.tierLabel}</td>
        ${cells}
      </tr>`;
    }
  }

  const head = `
    <thead><tr>
      <th>Item</th>
      <th>Tier</th>
      ${enchCols.map(e => `<th>Ench ${e}</th>`).join('')}
    </tr></thead>`;

  const missingNote = totalMissing.size
    ? `<div class="banner">⚠️ ${totalMissing.size} material price${totalMissing.size>1?'s are':' is'} missing — open <strong>Material Prices</strong> to fill them in.</div>`
    : '';

  // Artifact-price grid for this sheet (if any artifacts are defined for it).
  const sheetArtifacts = (State.data.materials || []).filter(m => m.kind === 'artifact' && m.sheet === sheet);
  const artBlock = sheetArtifacts.length ? `
    <div class="panel">
      <h2 class="panel__title">Artifact Prices</h2>
      <div class="mat-grid" style="grid-template-columns: 1fr;">${renderArtifactCard(sheet, sheetArtifacts)}</div>
    </div>` : '';

  return `
    <div class="page-header">
      <h1 class="page-title">${SHEET_LABELS[sheet] || sheet}</h1>
      <p class="page-sub" id="rate-stats">${recipes.length} recipes · effective return saved: <strong style="color:var(--accent)">${(ret*100).toFixed(2)}%</strong> · ${isRefining ? 'refining bonus city = 58%' : 'crafting bonus city = 33%'}</p>
    </div>
    ${renderSettingsControls({ compact: true, sheet })}
    ${missingNote}
    ${artBlock}
    <div class="panel" style="padding:0;">
      <div class="tbl-wrap">
        <table class="tbl">${head}<tbody>${body}</tbody></table>
      </div>
    </div>
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
    case 'settings':  html = pageSettings();  break;
    case 'sheet':     html = pageSheet(State.view.sheet); break;
    default:          html = pageHome();
  }
  main.innerHTML = html;

  // Bind page-specific handlers
  if (State.view.type === 'settings')   bindSettingsHandlers();
  if (State.view.type === 'materials')  bindMaterialsHandlers();
  if (State.view.type === 'sheet')    { bindSheetHandlers(); bindSettingsHandlers(); }
  if (State.view.type === 'home') {
    document.querySelectorAll('.landing-card[data-grp]').forEach(card => {
      card.addEventListener('click', () => {
        const grp = SHEET_GROUPS.find(g => g.title === card.dataset.grp);
        if (grp && grp.sheets.length) {
          const sh = grp.sheets.find(s => State.data.sheets.includes(s));
          if (sh) { State.view = { type: 'sheet', sheet: sh }; render(); }
        }
      });
    });
  }
}

// =============================================================================
// TOPBAR ACTIONS
// =============================================================================
function bindTopbar() {
  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({
      prices: State.prices, settings: State.settings,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'nendys-prices.json'; a.click();
    URL.revokeObjectURL(url);
  });

  const importInput = document.getElementById('importFile');
  document.getElementById('importBtn').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        if (obj.prices) { State.prices = obj.prices; savePrices(); }
        if (obj.settings) { Object.assign(State.settings, obj.settings); saveSettings(); }
        render();
      } catch { alert('Invalid JSON file.'); }
    };
    reader.readAsText(f);
    e.target.value = '';
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
// BOOT
// =============================================================================
async function boot() {
  document.getElementById('main').innerHTML = '<div class="loading">Loading recipe data…</div>';
  loadStored();
  try {
    const res = await fetch('data.json');
    State.data = await res.json();
  } catch (err) {
    document.getElementById('main').innerHTML =
      `<div class="panel"><p style="color:var(--bad)">Failed to load data.json: ${err.message}</p></div>`;
    return;
  }
  bindTopbar();
  render();
}

boot();
