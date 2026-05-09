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
 *    - heartReducesQty: subtract 1 from qty when Use Hearts is on. */
function computeRecipeCost(items, sheet) {
  const ret = returnFactor(sheet);
  const useHearts = !!State.settings.useHearts;
  let total = 0;
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
    // Hearts cost (heartGated) is outside the (1 - returnFactor) bracket in the
    // spreadsheet formula — they're not affected by return rate.
    const factor = it.heartGated ? 1 : (1 - ret);
    total += qty * Number(price) * factor;
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

function pageSettings() {
  const s = State.settings;
  return `
    <div class="page-header">
      <h1 class="page-title">Settings</h1>
      <p class="page-sub">Return rate &amp; bonuses applied to every cost calculation.</p>
    </div>
    <div class="panel">
      <h2 class="panel__title">Return Rate</h2>
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
      </div>
    </div>

    <div class="panel">
      <h2 class="panel__title">Other</h2>
      <div class="settings-grid">
        <div class="field">
          <label for="set-fee">Station Fee (silver / 100 nutrition)</label>
          <input type="number" id="set-fee" min="0" step="1" value="${s.stationFee}" />
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <label class="toggle"><input type="checkbox" id="set-hearts" ${s.useHearts?'checked':''}/> Use Hearts when refining T4+</label>
        </div>
      </div>
    </div>

    <div class="banner">
      <strong>Computed factor:</strong> with the current settings, you save
      <strong>${(returnFactor('Swords') * 100).toFixed(2)}%</strong> on crafting recipes and
      <strong>${(returnFactor('LeatherRefining') * 100).toFixed(2)}%</strong> on refining recipes.
    </div>
  `;
}

function bindSettingsHandlers() {
  const $ = id => document.getElementById(id);
  const onChange = () => {
    State.settings.location   = $('set-location').value;
    State.settings.bonusDay   = $('set-day').value;
    State.settings.focus      = $('set-focus').checked;
    State.settings.hideoutRate = Number($('set-hideout').value) || 0;
    State.settings.stationFee = Number($('set-fee').value) || 0;
    State.settings.useHearts  = $('set-hearts').checked;
    saveSettings();
    render();
  };
  ['set-location','set-day','set-focus','set-hideout','set-fee','set-hearts']
    .forEach(id => { const el = $(id); if (el) el.addEventListener('change', onChange); });
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
    { id: 'refined', label: 'Refined', families: ['PLANKS','STEEL','LEATHER','CLOTH','BLOCKS'] },
    { id: 'raw',     label: 'Raw',     families: ['LOGS','ORE','HIDE','FIBER','STONE'] },
    { id: 'hearts',  label: 'Hearts',  families: ['HEART'] },
    { id: 'misc',    label: 'Misc',    families: ['MISC'] },
    { id: 'food',    label: 'Food / Potion', families: ['FOOD_POTION'] },
  ];

  const activeTab = State._matsTab || 'refined';
  const grp = groups.find(g => g.id === activeTab) || groups[0];

  let cards = '';
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
        const { cost, missing } = computeRecipeCost(items, sheet);
        missing.forEach(m => totalMissing.add(m));
        if (missing.length === items.length) return `<td class="price-cell muted">no price</td>`;
        return `<td class="price-cell">${formatSilver(cost)}</td>`;
      }).join('');
      body += `<tr>
        <td class="item-name">${r.item}</td>
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

  return `
    <div class="page-header">
      <h1 class="page-title">${SHEET_LABELS[sheet] || sheet}</h1>
      <p class="page-sub">${recipes.length} recipes · effective return saved: <strong style="color:var(--accent)">${(ret*100).toFixed(2)}%</strong> · ${isRefining ? 'refining bonus city = 58%' : 'crafting bonus city = 33%'}</p>
    </div>
    ${missingNote}
    <div class="panel" style="padding:0;">
      <div class="tbl-wrap">
        <table class="tbl">${head}<tbody>${body}</tbody></table>
      </div>
    </div>
  `;
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
