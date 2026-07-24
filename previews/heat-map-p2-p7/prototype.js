const params = new URLSearchParams(location.search);
const isText200 = params.get('text') === '200';
if (isText200) {
  document.documentElement.classList.add('text-200');
}

const wardProfiles = {
  Ballygunge: { base: 39.6, uhi: 3.8, area: 43, zone: 'Urban Core · Ward 68', display: 'Bally<em>gunge</em>' },
  Baruipur: { base: 35.4, uhi: 1.4, area: 12, zone: 'Peri-Urban Fringe', display: 'Baru<em>ipur</em>' },
  Barrackpore: { base: 38.1, uhi: 3.1, area: 34, zone: 'Industrial River Corridor', display: 'Barrack<em>pore</em>' },
};

const state = {
  ward: params.get('ward') in wardProfiles ? params.get('ward') : 'Ballygunge',
  trees: Number(params.get('trees') ?? (document.body.classList.contains('brief-body') ? 24 : 0)),
  roof: Number(params.get('roof') ?? (document.body.classList.contains('brief-body') ? 65 : 0)),
  parks: Number(params.get('parks') ?? (document.body.classList.contains('brief-body') ? 4 : 0)),
  facades: Number(params.get('facades') ?? (document.body.classList.contains('brief-body') ? 5 : 0)),
};

function cooling() {
  return state.trees * 0.018 + state.roof * 0.011 + state.parks * 0.065 + state.facades * 0.024;
}

function scenario() {
  const profile = wardProfiles[state.ward];
  const delta = cooling();
  const mean = profile.base - delta;
  const uhi = Math.max(0.2, profile.uhi - delta * 0.8);
  const area = Math.max(2, Math.round(profile.area - delta * 9));
  const cost = state.trees * 0.055 + state.roof * 0.072 + state.parks * 1.18 + state.facades * 0.24;
  const score = Math.min(96, Math.round(24 + delta * 25));
  return { profile, delta, mean, uhi, area, cost, score };
}

function text(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function html(id, value) {
  const node = document.getElementById(id);
  if (node) node.innerHTML = value;
}

function selectedControlValue(selector, dataKey, fallback) {
  const selected = document.querySelector(`${selector}[aria-pressed="true"]`);
  return selected?.dataset[dataKey] ?? fallback;
}

function syncCompareLinks() {
  const links = document.querySelectorAll('.compare-action');
  if (!links.length) return;
  const secondaryWard = state.ward === 'Ballygunge' ? 'Baruipur' : 'Ballygunge';
  const treeCoverage = state.trees / 50 * 100;
  const parkShare = Math.min(4, Math.round((state.parks * 0.785 / 196 * 100) * 10) / 10);
  const facadeCoverage = Math.round((state.facades / 15 * 100) * 10) / 10;
  const phase = selectedControlValue('[data-field-phase]', 'fieldPhase', 'peak');
  const returnView = selectedControlValue('[data-map-view]', 'mapView', 'relief');
  const query = new URLSearchParams({
    a: state.ward,
    b: secondaryWard,
    pairTrees: String(treeCoverage),
    pairRoof: String(state.roof),
    pairParks: String(parkShare),
    pairFacades: String(facadeCoverage),
    phase,
    returnView,
    contract: 'paired-coverage-v1',
    prototype: 'synthetic',
  });
  if (document.documentElement.classList.contains('text-200')) query.set('text', '200');
  links.forEach((link) => {
    link.href = `paired-bench.html?${query}`;
  });
}

function syncReportLinks() {
  const query = new URLSearchParams({
    ward: state.ward,
    trees: String(state.trees),
    roof: String(state.roof),
    parks: String(state.parks),
    facades: String(state.facades),
  });
  if (document.documentElement.classList.contains('text-200')) query.set('text', '200');
  document.querySelectorAll('.report-link').forEach((link) => {
    link.href = `scenario-brief.html?${query}`;
  });
  syncCompareLinks();
}

function renderScenario({ announce = false } = {}) {
  const result = scenario();
  text('mean-result', `${result.mean.toFixed(1)}°C`);
  text('m-mean-result', `${result.mean.toFixed(1)}°C`);
  text('console-map-temp', `${result.mean.toFixed(1)}°C`);
  text('uhi-result', `+${result.uhi.toFixed(1)}°`);
  text('m-uhi-result', `+${result.uhi.toFixed(1)}°`);
  text('area-result', `${result.area}%`);
  text('m-cooling-result', `−${result.delta.toFixed(1)}°C`);
  text('m-cost-result', `₹${result.cost.toFixed(1)} cr`);
  text('summary-mean', `${result.mean.toFixed(1)}°`);
  text('summary-uhi', `+${result.uhi.toFixed(1)}°`);
  text('summary-area', `${result.area}%`);
  text('score', String(result.score));
  text('score-copy', result.delta > 0.05
    ? `−${result.delta.toFixed(1)}°C · ₹${result.cost.toFixed(1)} cr indicative cost`
    : 'Move a control to compare interventions.');

  if (announce) {
    text(
      'scenario-status',
      `Scenario updated. Mean surface temperature ${result.mean.toFixed(1)} degrees Celsius, a reduction of ${result.delta.toFixed(1)} degrees. Indicative cost ${result.cost.toFixed(1)} crore rupees.`,
    );
  }

  syncReportLinks();
}

const unitMap = {
  trees: (v) => `${v} km`,
  roof: (v) => `${v}%`,
  parks: (v) => `${v} ${Number(v) === 1 ? 'site' : 'sites'}`,
  facades: (v) => `${v} ${Number(v) === 1 ? 'block' : 'blocks'}`,
};

for (const key of Object.keys(unitMap)) {
  const desktop = document.getElementById(key);
  const mobile = document.getElementById(`m-${key}`);
  for (const input of [desktop, mobile].filter(Boolean)) {
    input.value = String(state[key]);
    const update = ({ announce = false } = {}) => {
      state[key] = Number(input.value);
      const peer = input === desktop ? mobile : desktop;
      if (peer) peer.value = input.value;
      text(`${key}-output`, unitMap[key](input.value));
      text(`m-${key}-output`, unitMap[key](input.value));
      renderScenario({ announce });
    };
    input.addEventListener('input', () => update());
    input.addEventListener('change', () => update({ announce: true }));
  }
  text(`${key}-output`, unitMap[key](state[key]));
  text(`m-${key}-output`, unitMap[key](state[key]));
}

function setWard(name) {
  state.ward = name;
  const profile = wardProfiles[name];
  document.querySelectorAll('[data-ward]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.ward === name));
  });
  html('place-name', profile.display);
  text('place-zone', profile.zone);
  text('summary-ward', name);
  text('sheet-title', `${name} scenario`);
  text('results-title', `${name} scenario`);
  renderScenario({ announce: true });
}

document.querySelectorAll('[data-ward]').forEach((button) => {
  button.addEventListener('click', () => setWard(button.dataset.ward));
});

const requestedFieldPhase = params.get('phase') === 'retained' ? 'retained' : 'peak';
document.querySelectorAll('[data-field-phase]').forEach((button) => {
  button.setAttribute('aria-pressed', String(button.dataset.fieldPhase === requestedFieldPhase));
});

const requestedMapView = params.get('view') === 'isotherm' ? 'isotherm' : 'relief';
document.querySelectorAll('[data-map-view]').forEach((button) => {
  button.setAttribute('aria-pressed', String(button.dataset.mapView === requestedMapView));
});

document.querySelectorAll('.segment').forEach((group) => {
  const buttons = [...group.querySelectorAll('button')];
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      buttons.forEach((peer) => peer.setAttribute('aria-pressed', String(peer === button)));
      syncCompareLinks();
    });
  });
});

const dock = document.getElementById('mobile-dock');
const mobileSheet = document.getElementById('mobile-sheet');
const sheetOpen = document.getElementById('sheet-open');
const sheetClose = document.getElementById('sheet-close');
const sheetExpand = document.getElementById('sheet-expand');
const sheetStates = new Set(['collapsed', 'half', 'full']);
const sheetStorageKey = 'dcr:heat-map:mobile-sheet';

function storedSheetState() {
  try {
    const stored = sessionStorage.getItem(sheetStorageKey);
    return sheetStates.has(stored) ? stored : null;
  } catch {
    return null;
  }
}

function storeSheetState(value) {
  try {
    sessionStorage.setItem(sheetStorageKey, value);
  } catch {
    // The state still works when storage is unavailable.
  }
}

function setSheetState(next, { focusWorkspace = false, persist = false } = {}) {
  if (!dock || !mobileSheet || !sheetOpen || !sheetStates.has(next)) return;
  dock.classList.toggle('is-half', next === 'half');
  dock.classList.toggle('is-full', next === 'full');
  dock.dataset.sheetState = next;
  sheetOpen.setAttribute('aria-expanded', String(next !== 'collapsed'));
  mobileSheet.toggleAttribute('inert', next === 'collapsed');
  mobileSheet.setAttribute('aria-hidden', String(next === 'collapsed'));

  if (sheetExpand) {
    const isFull = next === 'full';
    sheetExpand.textContent = isFull ? '⤡' : '⤢';
    sheetExpand.setAttribute('aria-pressed', String(isFull));
    sheetExpand.setAttribute(
      'aria-label',
      isFull ? 'Return scenario workspace to half height' : 'Expand scenario workspace to full screen',
    );
  }

  if (persist) storeSheetState(next);
  if (focusWorkspace && next !== 'collapsed') {
    mobileSheet.querySelector('[role="tab"][aria-selected="true"]')?.focus();
  }
}

if (dock && mobileSheet && sheetOpen && sheetClose) {
  const requestedSheetState = params.get('sheet');
  const initialSheetState = sheetStates.has(requestedSheetState)
    ? requestedSheetState
    : isText200
      ? 'full'
      : storedSheetState() ?? 'collapsed';
  setSheetState(initialSheetState);

  sheetOpen.addEventListener('click', () => {
    setSheetState(isText200 ? 'full' : 'half', { focusWorkspace: true, persist: true });
  });

  sheetClose.addEventListener('click', () => {
    setSheetState('collapsed', { persist: true });
    sheetOpen.focus();
  });

  sheetExpand?.addEventListener('click', () => {
    setSheetState(dock.dataset.sheetState === 'full' ? 'half' : 'full', { persist: true });
  });

  document.getElementById('mobile-skip-link')?.addEventListener('click', (event) => {
    if (!matchMedia('(max-width: 767px)').matches) return;
    event.preventDefault();
    setSheetState(isText200 ? 'full' : 'half', { focusWorkspace: true, persist: true });
  });
}

const tabs = [...document.querySelectorAll('[role="tab"]')];
const tabList = document.querySelector('[role="tablist"]');
if (tabList) {
  tabList.setAttribute('aria-orientation', isText200 ? 'vertical' : 'horizontal');
}

function selectTab(activeTab, { moveFocus = false } = {}) {
  for (const peer of tabs) {
    const selected = peer === activeTab;
    peer.setAttribute('aria-selected', String(selected));
    peer.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(peer.getAttribute('aria-controls'));
    if (panel) panel.hidden = !selected;
  }
  if (moveFocus) activeTab.focus();
}

for (const tab of tabs) {
  tab.addEventListener('click', () => {
    selectTab(tab);
  });

  tab.addEventListener('keydown', (event) => {
    const vertical = tabList?.getAttribute('aria-orientation') === 'vertical';
    const previousKey = vertical ? 'ArrowUp' : 'ArrowLeft';
    const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
    let nextIndex = null;
    if (event.key === previousKey) nextIndex = (tabs.indexOf(tab) - 1 + tabs.length) % tabs.length;
    if (event.key === nextKey) nextIndex = (tabs.indexOf(tab) + 1) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    selectTab(tabs[nextIndex], { moveFocus: true });
  });
}

function renderBrief() {
  if (!document.body.classList.contains('brief-body')) return;
  const result = scenario();
  const wardParts = state.ward === 'Ballygunge'
    ? ['Bally', 'gunge']
    : state.ward === 'Baruipur'
      ? ['Baru', 'ipur']
      : ['Barrack', 'pore'];
  const heading = document.querySelector('.brief h1');
  if (heading) heading.innerHTML = `${wardParts[0]}<em>${wardParts[1]}</em> intervention scenario.`;
  text('brief-baseline', `${result.profile.base.toFixed(1)}°C`);
  text('brief-mean', `${result.mean.toFixed(1)}°C`);
  text('brief-cooling', `−${result.delta.toFixed(1)}°C`);
  text('brief-area', `${result.area}%`);
  text('brief-cost', `₹${result.cost.toFixed(1)} cr`);
  text('brief-trees', unitMap.trees(state.trees));
  text('brief-roof', unitMap.roof(state.roof));
  text('brief-parks', unitMap.parks(state.parks));
  text('brief-facades', unitMap.facades(state.facades));
  const bars = {
    trees: state.trees / 50,
    roof: state.roof / 100,
    parks: state.parks / 10,
    facades: state.facades / 15,
  };
  for (const [key, ratio] of Object.entries(bars)) {
    document.getElementById(`brief-${key}-bar`)?.style.setProperty('--amount', `${Math.round(ratio * 100)}%`);
  }
}

const pairRoot = document.getElementById('paired-bench');

if (pairRoot) {
  const pairProfiles = {
    Ballygunge: {
      slug: 'ballygunge',
      zone: 'Dense urban core',
      coordinate: '1.4 km window · schematic',
      pattern: 'Schematic pattern: a broad central hotspot crossed by a dense road network, with cooler edges.',
      response: 1,
      nightBase: 33.4,
      nightUhi: 2.8,
      roadKm: 31.8,
      roofM2: 416000,
      facadeM2: 45000,
    },
    Baruipur: {
      slug: 'baruipur',
      zone: 'Peri-urban fringe',
      coordinate: '1.4 km window · schematic',
      pattern: 'Schematic pattern: an eastern hotspot beside a cooler western corridor and dispersed green patches.',
      response: 0.72,
      nightBase: 30.7,
      nightUhi: 1,
      roadKm: 19.4,
      roofM2: 248000,
      facadeM2: 24000,
    },
    Barrackpore: {
      slug: 'barrackpore',
      zone: 'Industrial river corridor',
      coordinate: '1.4 km window · schematic',
      pattern: 'Schematic pattern: a central industrial hotspot with a cooler western river edge.',
      response: 0.88,
      nightBase: 32.5,
      nightUhi: 2.3,
      roadKm: 27.1,
      roofM2: 355000,
      facadeM2: 52000,
    },
  };

  const pairNames = Object.keys(pairProfiles);
  const validPairName = (name, fallback) => (pairNames.includes(name) ? name : fallback);
  const numberWithin = (value, fallback, min, max) => {
    if (value === null || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  };

  const pairState = {
    a: validPairName(params.get('a'), 'Ballygunge'),
    b: validPairName(params.get('b'), 'Baruipur'),
    trees: numberWithin(params.get('pairTrees'), 55, 0, 100),
    roof: numberWithin(params.get('pairRoof'), 65, 0, 100),
    parks: numberWithin(params.get('pairParks'), 3, 0, 4),
    facades: numberWithin(params.get('pairFacades'), 35, 0, 100),
    phase: params.get('phase') === 'retained' ? 'retained' : 'peak',
    returnView: params.get('returnView') === 'isotherm' ? 'isotherm' : 'relief',
  };

  if (pairState.a === pairState.b) {
    pairState.b = pairNames.find((name) => name !== pairState.a) ?? 'Baruipur';
  }

  const pairControls = {
    trees: document.getElementById('pair-trees'),
    roof: document.getElementById('pair-roof'),
    parks: document.getElementById('pair-parks'),
    facades: document.getElementById('pair-facades'),
  };
  const selectA = document.getElementById('ward-a');
  const selectB = document.getElementById('ward-b');
  const studyAreaKm2 = 1.96;
  let pairAnnouncementTimer;
  const coverageValueText = {
    trees: (value) => `${value} percent of eligible priority-road network`,
    roof: (value) => `${value} percent of eligible roof stock`,
    parks: (value) => `${value} percent planted-area share of each study window`,
    facades: (value) => `${value} percent of eligible facade area`,
  };

  function pairPackageCooling() {
    if (pairState.phase === 'retained') {
      return (
        pairState.trees * 0.0045 +
        pairState.parks * 0.075 +
        pairState.facades * 0.0025
      );
    }
    return (
      pairState.trees * 0.008 +
      pairState.roof * 0.006 +
      pairState.parks * 0.11 +
      pairState.facades * 0.006
    );
  }

  function deliveredWorks(name) {
    const profile = pairProfiles[name];
    const treesKm = profile.roadKm * pairState.trees / 100;
    const roofM2 = profile.roofM2 * pairState.roof / 100;
    const parkHa = studyAreaKm2 * pairState.parks;
    const parkSiteEquivalents = parkHa / 0.785;
    const facadeM2 = profile.facadeM2 * pairState.facades / 100;
    const low =
      treesKm * 0.0055 +
      roofM2 * 16 / 10000000 +
      parkHa * 1.1 +
      facadeM2 * 2700 / 10000000;
    const high =
      treesKm * 0.033 +
      roofM2 * 270 / 10000000 +
      parkHa * 2.25 +
      facadeM2 * 17000 / 10000000;
    return { treesKm, roofM2, parkHa, parkSiteEquivalents, facadeM2, low, high };
  }

  function pairResult(name) {
    const profile = pairProfiles[name];
    const source = wardProfiles[name];
    const baseline = pairState.phase === 'retained' ? profile.nightBase : source.base;
    const baselineArea = pairState.phase === 'retained' ? null : source.area;
    const baselineContrast = pairState.phase === 'retained' ? profile.nightUhi : source.uhi;
    const delta = pairPackageCooling() * profile.response;
    const mean = baseline - delta;
    const hotArea = baselineArea === null ? null : Math.max(0, Math.round(baselineArea - delta * 9));
    const hotChange = baselineArea === null ? null : baselineArea - hotArea;
    const contrast = baselineContrast - delta * 0.8;
    return {
      profile,
      baseline,
      baselineArea,
      baselineContrast,
      delta,
      mean,
      hotArea,
      hotChange,
      contrast,
      works: deliveredWorks(name),
    };
  }

  function approxTemperature(value) {
    return `≈${value.toFixed(1)}°C`;
  }

  function coolingTemperature(value) {
    return value < 0.05 ? '≈0.0°C' : `≈−${value.toFixed(1)}°C`;
  }

  function approximateContrast(value) {
    if (Math.abs(value) < 0.05) return '≈0.0°C';
    return value > 0 ? `≈+${value.toFixed(1)}°C` : `≈−${Math.abs(value).toFixed(1)}°C`;
  }

  function formatCapitalRange(low, high) {
    if (high < 0.0005) return '₹0 cr';
    if (high < 1) {
      const formatLakh = (value) => value < 10 ? value.toFixed(1) : String(Math.round(value));
      return `₹${formatLakh(low * 100)}–${formatLakh(high * 100)} L`;
    }
    const formatCrore = (value) => value < 10 ? value.toFixed(1) : String(Math.round(value));
    return `₹${formatCrore(low)}–${formatCrore(high)} cr`;
  }

  function formatArea(value) {
    return `${Math.round(value / 100) * 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function updateSelectOptions() {
    if (!selectA || !selectB) return;
    selectA.value = pairState.a;
    selectB.value = pairState.b;
    [...selectA.options].forEach((option) => {
      option.disabled = option.value === pairState.b && option.value !== pairState.a;
    });
    [...selectB.options].forEach((option) => {
      option.disabled = option.value === pairState.a && option.value !== pairState.b;
    });
  }

  function updateMap(side, name, result) {
    const map = document.getElementById(`bench-map-${side}`);
    if (!map) return;
    map.dataset.mapWard = result.profile.slug;
    map.style.setProperty('--cooling-ratio', String(Math.min(0.8, result.delta / 2.2)));
    document.getElementById(`map-use-${side}`)?.setAttribute('href', `#geometry-${result.profile.slug}`);
    text(`map-name-${side}`, name);
    text(`map-zone-${side}`, result.profile.zone);
    text(`map-mean-${side}`, approxTemperature(result.mean));
    text(`map-cooling-${side}`, coolingTemperature(result.delta));
    text(`map-description-${side}`, result.profile.pattern);
    const coordinate = map.querySelector('.map-coordinate');
    if (coordinate) coordinate.textContent = result.profile.coordinate;
  }

  function updateDelivered(side, name, works) {
    text(`delivered-name-${side}`, `${side.toUpperCase()} · ${name}`);
    text(`trees-${side}`, `${works.treesKm.toFixed(1)} km corridors`);
    text(`roof-${side}`, `${formatArea(works.roofM2)} m² roofs`);
    const siteEquivalent = works.parkSiteEquivalents < 0.05
      ? '0 site eq.'
      : `≈${works.parkSiteEquivalents.toFixed(1)} site eq.`;
    text(`parks-${side}`, `${works.parkHa.toFixed(1)} ha · ${siteEquivalent}`);
    text(`facades-${side}`, `${formatArea(works.facadeM2)} m² façades`);
  }

  function updateTable(side, result) {
    text(`baseline-${side}`, approxTemperature(result.baseline));
    text(`scenario-${side}`, approxTemperature(result.mean));
    text(`cooling-${side}`, coolingTemperature(result.delta));
    const hotAreaCell = document.getElementById(`hot-area-${side}`);
    const hotChangeCell = document.getElementById(`hot-change-${side}`);
    if (result.hotArea === null) {
      for (const cell of [hotAreaCell, hotChangeCell].filter(Boolean)) {
        cell.textContent = '—';
        cell.title = 'Not evaluated at 22:00 in this prototype';
        cell.setAttribute('aria-label', 'Not evaluated at 22:00 in this prototype');
      }
    } else {
      if (hotAreaCell) {
        hotAreaCell.textContent = `${result.hotArea}%`;
        hotAreaCell.removeAttribute('title');
        hotAreaCell.removeAttribute('aria-label');
      }
      if (hotChangeCell) {
        hotChangeCell.textContent = result.hotChange ? `−${result.hotChange} pp` : '0 pp';
        hotChangeCell.removeAttribute('title');
        hotChangeCell.removeAttribute('aria-label');
      }
    }
    text(`contrast-${side}`, approximateContrast(result.contrast));
    text(`cost-${side}`, formatCapitalRange(result.works.low, result.works.high));
  }

  function updateReadout(side, name, result) {
    text(`readout-name-${side}`, `${side.toUpperCase()} · ${name}`);
    text(`readout-main-${side}`, approxTemperature(result.mean));
    text(`readout-delta-${side}`, `${coolingTemperature(result.delta)} from baseline`);
  }

  function updateDialog(side, name, result) {
    text(`dialog-name-${side}`, name);
    text(`dialog-mean-${side}`, approxTemperature(result.mean));
    text(`dialog-delta-${side}`, `${coolingTemperature(result.delta)} from its baseline`);
  }

  function renderPair({ announce = false } = {}) {
    const resultA = pairResult(pairState.a);
    const resultB = pairResult(pairState.b);
    updateSelectOptions();

    for (const [key, input] of Object.entries(pairControls)) {
      if (!input) continue;
      input.value = String(pairState[key]);
      text(`pair-${key}-output`, `${pairState[key]}%`);
      input.setAttribute('aria-valuetext', coverageValueText[key](pairState[key]));
    }

    document.querySelectorAll('[data-bench-phase]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.benchPhase === pairState.phase));
    });

    text('bench-pair-title', `${pairState.a} A ↔ ${pairState.b} B`);
    text('table-head-a', 'A');
    text('table-head-b', 'B');
    document.getElementById('table-head-a')?.setAttribute('aria-label', `Ward A, ${pairState.a}`);
    document.getElementById('table-head-b')?.setAttribute('aria-label', `Ward B, ${pairState.b}`);

    updateMap('a', pairState.a, resultA);
    updateMap('b', pairState.b, resultB);
    updateTable('a', resultA);
    updateTable('b', resultB);
    updateDelivered('a', pairState.a, resultA.works);
    updateDelivered('b', pairState.b, resultB.works);
    updateReadout('a', pairState.a, resultA);
    updateReadout('b', pairState.b, resultB);
    updateDialog('a', pairState.a, resultA);
    updateDialog('b', pairState.b, resultB);

    const phaseLabel = pairState.phase === 'retained' ? '22:00 retained' : '13:00 peak';
    text('readout-shared', `2025 · ${phaseLabel} · matched coverage`);
    const evidenceStrong = document.querySelector('.evidence-stamp strong');
    if (evidenceStrong) {
      evidenceStrong.textContent = pairState.phase === 'retained'
        ? '22:00 · matched reference'
        : '13:00 · matched reference';
    }

    const fieldState = new URLSearchParams({
      ward: pairState.a,
      trees: String(Math.round(pairState.trees / 100 * 50)),
      roof: String(pairState.roof),
      parks: String(Math.min(10, Math.round(pairState.parks * 1.96 / 0.785))),
      facades: String(Math.round(pairState.facades / 100 * 15)),
      phase: pairState.phase,
      view: pairState.returnView,
    });
    if (document.documentElement.classList.contains('text-200')) fieldState.set('text', '200');
    const exploreLink = document.getElementById('bench-explore-link');
    if (exploreLink) exploreLink.href = `field-instrument.html?${fieldState}`;

    text(
      'pair-synthesis',
      `${pairState.a} shows ${coolingTemperature(resultA.delta)} and ${pairState.b} ${coolingTemperature(resultB.delta)} under the shared package. These are within-area responses, not a ward ranking.`,
    );

    if (announce) {
      window.clearTimeout(pairAnnouncementTimer);
      pairAnnouncementTimer = window.setTimeout(() => {
        text(
          'pair-status',
          `Paired comparison updated. ${pairState.a} scenario mean approximately ${resultA.mean.toFixed(1)} degrees Celsius, cooling approximately ${resultA.delta.toFixed(1)} degrees. ${pairState.b} scenario mean approximately ${resultB.mean.toFixed(1)} degrees Celsius, cooling approximately ${resultB.delta.toFixed(1)} degrees.`,
        );
      }, 350);
    }
  }

  for (const [key, input] of Object.entries(pairControls)) {
    input?.addEventListener('input', () => {
      pairState[key] = Number(input.value);
      renderPair();
    });
    input?.addEventListener('change', () => renderPair({ announce: true }));
  }

  selectA?.addEventListener('change', () => {
    pairState.a = selectA.value;
    renderPair({ announce: true });
  });

  selectB?.addEventListener('change', () => {
    pairState.b = selectB.value;
    renderPair({ announce: true });
  });

  document.getElementById('swap-pair')?.addEventListener('click', () => {
    [pairState.a, pairState.b] = [pairState.b, pairState.a];
    renderPair({ announce: true });
  });

  document.querySelectorAll('[data-bench-phase]').forEach((button) => {
    button.addEventListener('click', () => {
      pairState.phase = button.dataset.benchPhase;
      renderPair({ announce: true });
    });
  });

  document.getElementById('bench-reset')?.addEventListener('click', () => {
    pairState.trees = 0;
    pairState.roof = 0;
    pairState.parks = 0;
    pairState.facades = 0;
    renderPair({ announce: true });
  });

  document.getElementById('copy-pair-link')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const url = new URL(location.href);
    url.search = new URLSearchParams({
      a: pairState.a,
      b: pairState.b,
      pairTrees: String(pairState.trees),
      pairRoof: String(pairState.roof),
      pairParks: String(pairState.parks),
      pairFacades: String(pairState.facades),
      phase: pairState.phase,
      returnView: pairState.returnView,
      contract: 'paired-coverage-v1',
      prototype: 'synthetic',
    }).toString();
    try {
      await navigator.clipboard.writeText(url.href);
      button.textContent = 'Comparison link copied';
    } catch {
      button.textContent = 'Copy unavailable';
    }
    window.setTimeout(() => {
      button.textContent = 'Copy comparison link';
    }, 1800);
  });

  const pairedBriefDialog = document.getElementById('paired-brief-dialog');
  document.getElementById('preview-paired-brief')?.addEventListener('click', () => {
    pairedBriefDialog?.showModal();
  });

  document.querySelector('.bench-actions a[href="#comparison-method"]')?.addEventListener('click', () => {
    document.getElementById('comparison-method')?.setAttribute('open', '');
  });

  renderPair();
}

document.getElementById('print-brief')?.addEventListener('click', () => window.print());
document.getElementById('copy-link')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText(location.href);
    button.textContent = 'Link copied';
  } catch {
    button.textContent = 'Copy unavailable';
  }
});

setWard(state.ward);
renderScenario();
renderBrief();
