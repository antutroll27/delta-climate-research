// src/components/ClimateEngine/v2/icons.ts — OBOS v2 spec §3.1; paths from the preview index.html :259–273
export const ICON: Readonly<Record<string, string>> = Object.freeze({
  overview: '<path d="M3 8.5 10 3l7 5.5V16a1 1 0 0 1-1 1h-3.5v-5h-5v5H4a1 1 0 0 1-1-1Z"/>',
  heat: '<path d="M8.5 3.5a1.5 1.5 0 0 1 3 0v8.2a3.5 3.5 0 1 1-3 0Z"/><circle cx="10" cy="14.5" r="1.2"/>',
  air: '<path d="M3 7.5h8.5a2.5 2.5 0 1 0-2.5-2.5M3 11h12a2.5 2.5 0 1 1-2.5 2.5M3 14.5h5"/>',
  solar: '<circle cx="10" cy="10" r="3.2"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
  weather: '<path d="M6 15.5h8.5a3 3 0 0 0 .3-6A4.5 4.5 0 0 0 6.2 9a3.3 3.3 0 0 0-.2 6.5Z"/>',
  scenarios: '<path d="M4 16V9M10 16V4M16 16v-5"/><circle cx="4" cy="7" r="1.6"/><circle cx="16" cy="9" r="1.6"/>',
  compare: '<rect x="2.5" y="4" width="6" height="12" rx="1"/><rect x="11.5" y="4" width="6" height="12" rx="1"/>',
  methods: '<path d="M5 3.5h7l3 3V16a.5.5 0 0 1-.5.5h-9.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5ZM7.5 9.5h5M7.5 12.5h5M7.5 6.5h2.5"/>',
  trees: '<path d="M10 17v-4M10 13c-3.5 0-5.5-2-5.5-4.5S7 3 10 3s5.5 3 5.5 5.5S13.5 13 10 13Z"/>',
  street: '<rect x="3" y="5.5" width="14" height="10" rx="2"/><circle cx="10" cy="10.5" r="2.8"/><path d="M7 5.5 8 3.5h4l1 2"/>',
  layers: '<path d="M10 3 2.5 7 10 11l7.5-4Z"/><path d="m2.5 10.5 7.5 4 7.5-4"/><path d="m2.5 14 7.5 4 7.5-4"/>',
  menu: '<path d="M3.5 6h13M3.5 10h13M3.5 14h13"/>',
  collapse: '<path d="M12 5 7 10l5 5"/>',
  expand: '<path d="M8 5l5 5-5 5"/>',
});
