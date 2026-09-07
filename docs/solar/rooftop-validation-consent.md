# Rooftop solar study — what we ask of you, and what we do with it

*Draft for the founder's and a lawyer's eye before it reaches an owner. Plain language on purpose.*

## What this is

Delta Climate Research has built a free screen that estimates how much solar each roof in Ballygunge,
Barrackpore and Baruipur could hold and generate. We have never compared it with real rooftop systems.
Yours would help us find out how good or bad the screen is, and we will publish the answer either way.

## What we ask for

- The **monthly generation** of your rooftop system, from your inverter's app or portal, or from your
  electricity bill, for as many months as you have.
- Your system's **size** (kilowatts), the **tilt** and **direction** of the panels, and when it was installed.
- The **address**, so we can match your roof to the building on our map. The address is not kept.

Ten minutes, once. Nothing is installed, nothing is touched.

## What we do with it

- We keep an anonymous record: a roof number, the ward, the building's index on our map, and your figures.
  **Your name and address are not stored** in our files and are never published.
- We publish the study's result on our website with the number of roofs and the months covered. Individual
  roofs are not identifiable in what we publish.
- We do not sell, share or pass your data to anyone, including installers, utilities or the municipality.
- You can withdraw at any time by emailing us; your row is deleted.

## What you get

- Your roof's screen result and how it compared with your real generation, as a one-page sheet.
- Our thanks, and a study that makes the next owner's decision better.

There is no payment either way.

**Contact:** ant@deltaclimate.earth (technical) · angad@deltaclimate.earth

---

## The data sheet (one per roof)

| field | what to write | example |
|---|---|---|
| System size | DC kilowatts, from the installer's invoice or the inverter app | 5.4 kW |
| Panels face | the direction the panels face | south, or south-west |
| Tilt | the angle from flat, if known; "flat" or "on a frame" is fine | 20° |
| Installed on | month and year | March 2024 |
| Monthly generation | kWh per month, as many months as you have | Jan 2025: 512, Feb 2025: 588, … |
| Outages | any month the system was off for more than three days, and roughly how long | Aug 2025: 9 days |
| Inverter app | the make, so we can help you export | Growatt, SolarEdge, Fronius, Sungrow, Huawei, other |
| Anything else | shading you know of, a tank moved, panels cleaned | "neighbour's mango tree, west side" |

**Exporting from the app:** most inverter portals have a *Reports* or *Energy* page with a monthly view and
an export button. A screenshot of the monthly bar chart is enough if the export is awkward.

*Internal: rows are entered into `data/calibration/pv-validation-measured.csv` by a team member under the
pre-registration in `docs/superpowers/specs/2026-09-07-pv-rooftop-validation-design.md`, with the address
replaced by the building index at entry.*
