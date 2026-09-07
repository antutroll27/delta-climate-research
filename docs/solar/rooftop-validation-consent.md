# Got solar on your roof? Help me check our maths.

Hi, I'm Antariksha. I build the tech at Delta Climate Research.

We've made a free map that guesses how much solar every roof in Ballygunge, Barrackpore and Baruipur
could hold, and how much it would generate. Here's the honest bit: we have never checked that guess
against a real roof. Not one. Yours could be the first.

We'll publish whatever we find, even if it makes us look bad. Especially then.

## What I'm asking for

Ten minutes, once. No visit, no wires, nobody climbing on your roof.

- **Your system's monthly generation**, from the inverter app or your electricity bill. As many months as
  you've got.
- **The basics of the system:** how big it is in kilowatts, which way the panels face, how tilted they
  are, and when it went up.
- **Your address**, only so I can find your roof on our map. I don't keep it.

## What I do with it

- I keep one anonymous row: a roof number, the ward, the building's number on our map, and your figures.
  Your name and address don't go in the file. Ever.
- We publish the overall result on our website: how many roofs, how many months, and how close we got.
  Nobody can pick your roof out of it.
- We don't sell it, share it, or hand it to anyone. Not installers, not the electricity company, not the
  municipality.
- Changed your mind? Email me and your row is gone the same day.

## What you get

- A one-page sheet: what our map said about your roof, next to what your roof actually did.
- A better map for the next person on your street who's thinking about solar.
- My genuine thanks, which cost nothing and are meant.

No money changes hands, in either direction.

**Me:** ant@deltaclimate.earth · **Angad, our founder:** angad@deltaclimate.earth

---

## The sheet (one per roof)

| what | what to write | example |
|---|---|---|
| System size | kilowatts, from the installer's invoice or the inverter app | 5.4 kW |
| Panels face | the direction they point | south, or south-west |
| Tilt | the angle from flat. "Flat" or "on a frame" is fine if you don't know | 20° |
| Installed | month and year | March 2024 |
| Monthly generation | kWh per month, as many as you have | Jan 2025: 512 · Feb 2025: 588 · … |
| Off days | any month the system was off for more than three days, and roughly how long | Aug 2025: 9 days |
| Inverter app | the make, so I can help you export | Growatt, SolarEdge, Fronius, Sungrow, Huawei, other |
| Anything else | shading you know about, a tank that moved, a cleaning | "neighbour's mango tree, west side" |

**Getting the numbers out of the app:** most inverter apps have a *Reports* or *Energy* page with a monthly
view and an export button. If the export is a pain, a screenshot of the monthly bar chart is enough.

*Internal: rows go into `data/calibration/pv-validation-measured.csv` by a team member, under the
pre-registration in `docs/superpowers/specs/2026-09-07-pv-rooftop-validation-design.md`, with the
address replaced by the building index at entry. Draft v1, 7 September 2026, for Angad's and a lawyer's
eye before it reaches an owner.*
