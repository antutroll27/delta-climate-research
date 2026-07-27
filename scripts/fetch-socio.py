#!/usr/bin/env python3
"""
Socio-economic heat vulnerability per ward, for the DC-URS exposure pillar.

    python3 scripts/fetch-socio.py

`HVI_socio` is the source document's composite of elderly (>65), children (<5),
low-income share and informal-settlement fraction, on a 0-10 scale
(dc-urs-source-of-truth.md §3, Pillar 2). It carries 0.25 of the exposure pillar.

THIS SCRIPT DOES NOT FETCH ANYTHING, and the name is kept only for continuity
with the plan. It reads hand-transcribed values from
`data/dc-urs/socio-sources.json`, validates them, and computes the composite.

WHY. Every automated route was tested and none survives:

  WorldPop gridded age structure   1.5 GB per band x 12 bands, and the server
                                   rejects HTTP range reads. ~19 GB for four numbers.
  GHSL                             publishes no socio-demographic layer at all.
  NFHS-5 state report (FR374)      READ IT: it is a HEALTH survey covering women
                                   15-49 and children under 5. It carries no 65+
                                   population share and no slum variable. Half the
                                   composite simply is not in it.
  census2011.co.in                 returned HUGLI district for a Kolkata URL and
                                   placed Hooghly in Maharashtra. Factually wrong.
  censusindia.gov.in               authoritative, but XLSX/PDF behind navigation.

So the numbers come off PDFs by hand. Given that, the honest design is a declared
input file where each value carries its citation, and a script that validates and
computes rather than one that pretends to automate. Hardcoding transcribed values
inside a script would hide exactly the provenance this pillar most needs.

HYBRID VINTAGE (option C). Age structure and informal settlement come from Census
of India 2011 — the only instrument that measures them, and there is no newer
census: the 2021 round was deferred and is now Census 2027. Deprivation comes
from NFHS-5, fielded 2019-21. Both vintages are carried through to the output and
displayed; they are never averaged into one date.

DISTRICT RESOLUTION. The three wards sit in three different districts — Kolkata,
North 24 Parganas, South 24 Parganas — so district figures do vary per ward. But
they are district figures, not ward figures, and a dense ward inside a mixed
district inherits its district's average. Stated in the output, not hidden.

Output: data/dc-urs/socio.json
"""
from __future__ import annotations

import json
import os
import sys
from typing import TypedDict, cast

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _types  # noqa: E402  (path must be set first — the scripts are not a package)

ROOT = os.path.join(HERE, "..")
SRC = os.path.join(ROOT, "data", "dc-urs", "socio-sources.json")
OUT = os.path.join(ROOT, "data", "dc-urs", "socio.json")

# Composite weights. Equal thirds across the two age-vulnerable groups and the
# two socio-economic terms would over-weight age, so the four components are
# equal-weighted, matching the source document's phrasing ("composite ratio of
# elderly, children, low-income demographics, and informal settlement fraction")
# which lists them without precedence.
W_ELDERLY = 0.25
W_CHILDREN = 0.25
W_LOW_INCOME = 0.25
W_INFORMAL = 0.25

# Normalisation ceilings, i.e. the share at which a component scores its full
# quarter. Chosen from the plausible range for Indian urban districts rather than
# from these three districts — a max taken over three units would make the worst
# of them 1.0 by construction and would rescore every ward when a fourth is added,
# which is the same min-max trap the spec rejects for the main anchors.
CEIL_ELDERLY = 0.15        # 15 % aged 65+ is high for an Indian district
CEIL_CHILDREN = 0.15       # 15 % under 5
CEIL_LOW_INCOME = 0.40     # 40 % in the lowest wealth quintile
CEIL_INFORMAL = 0.40       # 40 % of population in slum households

HVI_SCALE = 10.0           # the source document's 0-10 range


class CensusBlock(TypedDict):
    population_total: float | None
    population_under_5: float | None
    population_65_plus: float | None
    slum_population: float | None
    #: the slum count's OWN denominator — the municipality, not the district
    slum_town_population: float | None


class NfhsBlock(TypedDict):
    lowest_wealth_quintile_pct: float | None
    improved_sanitation_pct: float | None
    clean_cooking_fuel_pct: float | None


def clamp(share: float, ceiling: float) -> float:
    """A share as a fraction of its ceiling, capped at 1."""
    return min(1.0, max(0.0, share / ceiling))


def frac(part: float | None, whole: float | None, what: str, district: str) -> float:
    """A share, or a labelled exit. Never a silent zero."""
    if part is None or whole is None:
        sys.exit(f"{district}: {what} is not filled in. Edit "
                 f"data/dc-urs/socio-sources.json — a missing value must not become a zero, "
                 f"because zero vulnerability reads as LOW exposure and would inflate the score.")
    if whole <= 0:
        sys.exit(f"{district}: population_total is {whole}, which cannot be a denominator")
    if part < 0 or part > whole:
        sys.exit(f"{district}: {what} is {part:,.0f} against a population of {whole:,.0f} — "
                 f"a share cannot be negative or exceed the whole")
    return part / whole


def pct(value: float | None, what: str, district: str) -> float:
    if value is None:
        sys.exit(f"{district}: {what} is not filled in. Edit data/dc-urs/socio-sources.json.")
    if not 0 <= value <= 100:
        sys.exit(f"{district}: {what} is {value}, which is not a percentage")
    return value / 100.0


def main() -> None:
    if not os.path.exists(SRC):
        sys.exit(f"{os.path.relpath(SRC, ROOT)} is missing — it is the hand-entered input "
                 f"this script reads. See its _README for where each number comes from.")
    with open(SRC) as fh:
        try:
            src = json.load(fh)
        except json.JSONDecodeError as e:
            sys.exit(f"socio-sources.json is not valid JSON (line {e.lineno}): {e.msg}")

    wards: dict[str, _types.SocioWard] = {}
    unfilled: list[str] = []

    for district, blk in src["districts"].items():
        ward = blk["_ward"]
        c = cast(CensusBlock, blk["census2011"])
        n = cast(NfhsBlock, blk["nfhs5"])

        # Report every gap at once rather than exiting on the first, so one pass
        # through the PDFs collects everything.
        missing = [k for k, v in list(c.items()) + list(n.items())
                   if not k.startswith("_") and not isinstance(v, str) and v is None]
        if missing:
            unfilled.append(f"  {district} ({ward}): {', '.join(missing)}")
            continue

        total = c["population_total"]
        elderly = frac(c["population_65_plus"], total, "population_65_plus", district)
        children = frac(c["population_under_5"], total, "population_under_5", district)
        # THE SLUM TERM HAS ITS OWN DENOMINATOR, and using `total` here is a bug that
        # produces a plausible number. The slum count is TOWN-level (Primary Census
        # Abstract for Slum); the district population is not its denominator. Dividing
        # Baruipur's 13,679 town slum residents by South 24 Parganas' 8.16 M gives 0.2 %
        # instead of 25.7 % — a real share, in the right units, understated 150-fold.
        # Kolkata masks the error because its corporation and district are the same area.
        informal = frac(c["slum_population"], c["slum_town_population"],
                        "slum_population (over its own town)", district)
        low_income = pct(n["lowest_wealth_quintile_pct"], "lowest_wealth_quintile_pct", district)

        hvi = HVI_SCALE * (
            W_ELDERLY * clamp(elderly, CEIL_ELDERLY)
            + W_CHILDREN * clamp(children, CEIL_CHILDREN)
            + W_LOW_INCOME * clamp(low_income, CEIL_LOW_INCOME)
            + W_INFORMAL * clamp(informal, CEIL_INFORMAL)
        )

        wards[ward] = {
            "hvi": round(hvi, 3),
            "elderly_frac": round(elderly, 4),
            "children_frac": round(children, 4),
            "low_income_frac": round(low_income, 4),
            "informal_frac": round(informal, 4),
        }

    if unfilled:
        print("  NOT READY — these values are still null in socio-sources.json:")
        for line in unfilled:
            print(line)
        print("\n  Each must be transcribed from its primary source; see the _README and")
        print("  _where_to_get_them in that file. Nothing is written until all are present,")
        print("  because a partial socio.json would let a null quietly become a zero, and")
        print("  zero vulnerability reads as LOW exposure — inflating the score.")
        sys.exit(1)

    out: _types.SocioFile = {
        "source": "Census of India 2011 (age structure, slum population) + NFHS-5 2019-21 "
                  "district fact sheets (wealth quintile). Hand-transcribed; see "
                  "data/dc-urs/socio-sources.json for the per-value citations.",
        "method": f"Equal-weighted composite on a 0-{HVI_SCALE:.0f} scale of four shares, each "
                  f"normalised against a fixed ceiling: 65+ /{CEIL_ELDERLY}, under-5 "
                  f"/{CEIL_CHILDREN}, lowest wealth quintile /{CEIL_LOW_INCOME}, slum "
                  f"/{CEIL_INFORMAL}. Ceilings are plausible-range values for Indian urban "
                  f"districts, NOT the max over these three — a max over three units makes the "
                  f"worst of them 1.0 by construction and rescores every ward when a fourth "
                  f"is added.",
        "vintage": "2011 (age, slum) + 2019-21 (wealth)",
        "caveat": "TWO LIMITATIONS, both structural. (1) Vintage: age structure and slum share "
                  "can only come from a census, and India's last was 2011 — the 2021 round was "
                  "deferred to Census 2027. NFHS-5 is current but is a health survey and carries "
                  "neither variable. (2) Resolution: these are DISTRICT figures. The three wards "
                  "sit in three different districts so the values do vary between them, but a "
                  "ward inherits its district's average and within-district variation is invisible.",
        "provenance": "measured",
        "wards": wards,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=2)

    print(f"  {'ward':<14}{'HVI':>7}{'65+':>8}{'<5':>8}{'low-inc':>9}{'slum':>8}")
    for w, v in wards.items():
        print(f"  {w:<14}{v['hvi']:>7.2f}{v['elderly_frac']:>8.1%}{v['children_frac']:>8.1%}"
              f"{v['low_income_frac']:>9.1%}{v['informal_frac']:>8.1%}")
    print(f"\n  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
