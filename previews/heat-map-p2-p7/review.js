const frame = document.querySelector('#preview-frame');
const device = document.querySelector('#device');
const openTab = document.querySelector('#open-tab');
const previewButtons = [...document.querySelectorAll('[data-preview]')];
const deviceButtons = [...document.querySelectorAll('[data-device]')];
const sheetButtons = [...document.querySelectorAll('[data-sheet]')];

let activePage = 'field-instrument.html';
let activeDevice = 'desktop';
let activeSheet = 'collapsed';

function frameUrl() {
  const query = new URLSearchParams();
  if (activeDevice === 'zoom') query.set('text', '200');
  if (['field-instrument.html', 'paired-bench.html'].includes(activePage)) query.set('sheet', activeSheet);
  const search = query.toString();
  return `${activePage}${search ? `?${search}` : ''}`;
}

function refreshFrame() {
  const url = frameUrl();
  frame.src = url;
  openTab.href = url;
  device.dataset.device = activeDevice;
  device.dataset.deviceLabel = activeDevice === 'zoom' ? '390px · 200% text' : '390 × 844';
}

function setPressed(buttons, activeButton) {
  for (const peer of buttons) {
    peer.setAttribute('aria-pressed', String(peer === activeButton));
  }
}

function pressByValue(buttons, dataKey, value) {
  for (const peer of buttons) {
    peer.setAttribute('aria-pressed', String(peer.dataset[dataKey] === value));
  }
}

for (const button of previewButtons) {
  button.addEventListener('click', () => {
    activePage = button.dataset.preview;
    if (activePage === 'paired-bench.html') {
      activeDevice = 'desktop';
      pressByValue(deviceButtons, 'device', activeDevice);
    }
    setPressed(previewButtons, button);
    refreshFrame();
  });
}

for (const button of deviceButtons) {
  button.addEventListener('click', () => {
    activeDevice = button.dataset.device;
    if (activeDevice === 'zoom') {
      activeSheet = 'full';
      pressByValue(sheetButtons, 'sheet', activeSheet);
    }
    setPressed(deviceButtons, button);
    refreshFrame();
  });
}

for (const button of sheetButtons) {
  button.addEventListener('click', () => {
    if (!['field-instrument.html', 'paired-bench.html'].includes(activePage)) {
      activePage = 'field-instrument.html';
      pressByValue(previewButtons, 'preview', activePage);
    }
    activeDevice = 'mobile';
    activeSheet = button.dataset.sheet;
    pressByValue(deviceButtons, 'device', activeDevice);
    setPressed(sheetButtons, button);
    refreshFrame();
  });
}

refreshFrame();
