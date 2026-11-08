# Amsterdam stadsdelen: is the boundary data open enough to name sheets after?

Read 2026-11-07 for city-streaming phase P1 (naming rule, plan decision D6: "F4 · Oost" only if the stadsdeel
boundary licence is confirmed open). All requests used the generic user-agent `obos-pipeline/1.0 (+https://deltaclimate.earth)`.

## Verdict

**Open. The stadsdeel names may be shown.** The Gemeente Amsterdam publishes the registry the stadsdelen come from,
Kernregistratie gebieden, as **CC0 1.0** in the national open-data catalogue, and its own Maps Data terms allow any
lawful use, commercial included, with no attribution duty. Sheets are therefore labelled "F4 · Oost" (code + the
stadsdeel with the largest share of the sheet's municipal area). Canal Ring keeps "E4 · Canal Ring".

## What was read

1. **data.overheid.nl catalogue record "Kernregistratie gebieden"** (CKAN `5l2csm77flzgya`, publisher
   `http://standaarden.overheid.nl/owms/terms/Amsterdam`, organisation "Gemeente Amsterdam"). Fetched through
   `https://data.overheid.nl/data/api/3/action/package_search?q=stadsdelen+amsterdam`. Description: "In de Registratie
   gebieden worden de Amsterdamse stadsdelen, wijken, buurten en bouwblokken vastgelegd." Licence field:
   `license_title: "CC-0 (1.0)"`, `license_id: http://creativecommons.org/publicdomain/zero/1.0/deed.nl`. Record
   metadata modified 2024-01-19. The record is saved next to this note: `2026-11-07-amsterdam-stadsdelen-licence/kernregistratie-gebieden-ckan-record.json`
   (13 KB; the search response it came from is in `/Volumes/OBOSLab/research/city-streaming/evidence/data-overheid-package_search-stadsdelen.json`).
2. **Maps Data terms** (`https://maps.amsterdam.nl/open_geodata/terms.php`, HTTP 200, read in full; the page as fetched is kept, with its scripts, at
   `/Volumes/OBOSLab/research/city-streaming/evidence/maps-data-terms.html` rather than in the repo). The Maps Data list
   (`https://maps.amsterdam.nl/open_geodata/`) offers "Amsterdam Stadsdelen" (id 202) and "Amsterdam Stadsdelen excl.water"
   (id 203). The terms: "verleent u hierbij een licentie voor het gebruiken en hergebruiken van de gedownloade dataset
   voor elk wettig doel. U mag de dataset zowel voor niet-commerciële als commerciële doeleinden gebruiken." Attribution:
   "Bij hergebruik van de dataset is bronvermelding niet verplicht, al wordt dat wel op prijs gesteld"; the user may not
   suggest that the Gemeente endorses the derived work and may not use its logo or emblem.
3. **The API we read** (`https://api.data.amsterdam.nl/v1/gebieden/stadsdelen/`, schema
   `https://schemas.data.amsterdam.nl/datasets/gebieden/dataset`, publisher `BENK`, "Datateam Basis- en Kernregistraties",
   `auth: OPENBAAR`). The schema carries **no licence field**, and the API documentation page
   (`/v1/docs/datasets/gebieden.html`) states no licence either. The schema is saved as `2026-11-07-amsterdam-stadsdelen-licence/gebieden-api-schema.json`.

## What this does and does not settle

- The CC0 statement is on the **catalogue record** for the registry (the municipality is the named publisher), not in the
  API's own schema. The API and the catalogue serve the same registry (Gemeente Amsterdam, BENK), and the Maps Data terms
  independently allow commercial reuse of the same stadsdelen. Two separate municipal statements point the same way and none
  contradicts them, so this is treated as open. If a reviewer wants a statement on the API itself, the Gemeente's data team
  (`gebruik.basisinformatie@amsterdam.nl`, the schema's `authorizationGrantor`) is the contact; that is the only thing that
  would close it further.
- **What OBOS uses**: the nine stadsdeel *names*, and the polygons only to intersect with our own sheets to find the
  largest share. **No geometry from this source is redistributed.** The names are administrative facts.
- Credit: not required. `data/cities/amsterdam/sources.json` (entry `amsterdam-stadsdelen`) keeps a courtesy source line.
  We do not use the Gemeente's logo or imply its endorsement.
- If the licence ever read as restricted, the fallback is the lattice code alone ("F4"); `label_of` in `scripts/_sheets.py`
  is the one place that composes the label.
