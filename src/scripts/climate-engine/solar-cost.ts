/**
 * THE SOLAR PAYBACK COST BASIS (spec 2026-09-30-solar-roi §3.1), one per city.
 *
 * Every number the payback sheet starts from is here, and every one carries the
 * document it came from and the day it was read. The sheet prints the assumptions
 * it used and lets the reader change the price and the tariff; it never asserts a
 * price. A basis with any unsourced value is refused whole (`costBasisFor` returns
 * null), and the sheet's button is then hidden rather than computing on a guess.
 *
 * Sources and search trails: docs/evidence/solar-payback-cost-basis.md.
 */
export interface Sourced<T> {
  readonly value: T;
  readonly source: string;
  readonly as_of: string;
}

export interface SizingBand {
  /** inclusive upper bound of average monthly units; null = no upper bound */
  readonly maxUnits: number | null;
  /** suggested system size, kW; hi null = "above lo" */
  readonly kw: readonly [number, number | null];
}

export interface SolarCostBasis {
  readonly city: string;
  readonly subsidy: {
    readonly home: Sourced<{ readonly perKwFirst2: number; readonly perKwThird: number; readonly cap: number }>;
    readonly society: Sourced<{ readonly perKw: number; readonly capKw: number }>;
  };
  /** installed cost per kW before subsidy, [low, high], in whole units of the currency */
  readonly costPerKw: Sourced<readonly [number, number]>;
  /** per kWh; also the solar pane's default tariff */
  readonly tariff: Sourced<number>;
  /** per kWh credited for generation beyond the household's own yearly use; 0 where it lapses */
  readonly surplusCreditPerKwh: Sourced<number>;
  /** fractions: 0.025 = 2.5 % */
  readonly degradation: Sourced<{ readonly firstYear: number; readonly perYear: number }>;
  /** fraction of gross installed cost per year: 0.01 = 1 % */
  readonly upkeepPctPerYr: Sourced<number>;
  readonly inverter: Sourced<{ readonly year: number; readonly perKw: number }>;
  readonly horizonYears: Sourced<number>;
  readonly sizingByUnits: Sourced<readonly SizingBand[]>;
}

const PSG_PDF = 'PM Surya Ghar CFA structure, official PDF 7 Mar 2024: '
  + 'https://pmsg-production-public.s3.ap-south-1.amazonaws.com/CFA_structure20240307.pdf';
const READ = '2026-09-30';

export const SOLAR_COST: Readonly<Record<string, SolarCostBasis>> = {
  kolkata: {
    city: 'kolkata',
    subsidy: {
      home: { value: { perKwFirst2: 30000, perKwThird: 18000, cap: 78000 }, source: PSG_PDF, as_of: READ },
      society: { value: { perKw: 18000, capKw: 500 }, source: `${PSG_PDF} (GHS/RWA, common facilities)`, as_of: READ },
    },
    costPerKw: {
      value: [55000, 65000],
      source: '2026 installer market range; MNRE scheme benchmark 50,000 per kW for the first 2 kW and 45,000 after (13 Feb 2024)',
      as_of: READ,
    },
    tariff: {
      value: 8.0,
      source: 'Assumed. CESC domestic slabs run 4.07-9.21 per unit (2025-26 tariff order); a solar unit displaces the top of the bill',
      as_of: READ,
    },
    surplusCreditPerKwh: {
      value: 0,
      source: 'WBERC Grid Interactive Rooftop Solar PV Regulations 2025 (notified as No. 81/WBERC, Kolkata Gazette 31 Jul 2025): under both net billing and net metering, a net amount receivable or net exported energy remaining at the end of the settlement period (1 April to 31 March) is reset to zero; the FY 2025-26 L&MV feed-in tariff of 4.80 per kWh (WBERC SM-40, 20.08.2025, para 5.0) only offsets imports within the year',
      as_of: READ,
    },
    degradation: {
      value: { firstYear: 0.03, perYear: 0.005 },
      source: 'MNRE PM Surya Ghar guidelines (Jul 2025), module spec 1.9: more than 97 % output in year 1 and below 0.5 % degradation per annum; the minimum every subsidised module must meet',
      as_of: READ,
    },
    upkeepPctPerYr: {
      value: 0.01,
      source: 'KERC order KERC/S/F-32/V-29/2407 (25.08.2026) s.7: O&M at 1 % of capital cost (a Karnataka generator norm; no West Bengal or MNRE residential figure found); applied flat in constant rupees, like the tariff, so the 5.72 %/yr escalation in the norm is not modelled; PM Surya Ghar vendors maintain free for the first 5 years',
      as_of: READ,
    },
    inverter: {
      value: { year: 10, perKw: 8000 },
      source: 'Waaree 3 kW on-grid inverter at 7,866 per kW incl. taxes, excluding installation labour (shop.waaree.com, 2026-09-30); 8,000 per kW is that price rounded up to allow for labour (a decision, not a quoted figure); replaced in year 10, the end of the Havells Enviro GTi 10-year warranty (assumption: no primary lifetime study found)',
      as_of: READ,
    },
    horizonYears: { value: 25, source: 'Module performance warranty life; both Waaree and Vikram calculators use 25 years', as_of: READ },
    sizingByUnits: {
      value: [
        { maxUnits: 150, kw: [1, 2] },
        { maxUnits: 300, kw: [2, 3] },
        { maxUnits: null, kw: [3, null] },
      ],
      source: `${PSG_PDF} (suitable capacity by average monthly consumption)`,
      as_of: READ,
    },
  },
};

const sourced = (f: { source: string; as_of: string }): boolean =>
  f.source.trim().length > 10 && /^\d{4}-\d{2}-\d{2}$/.test(f.as_of);

/** True when every value carries a source and a date. */
export function isComplete(b: SolarCostBasis): boolean {
  return [b.subsidy.home, b.subsidy.society, b.costPerKw, b.tariff, b.surplusCreditPerKwh, b.degradation,
    b.upkeepPctPerYr, b.inverter, b.horizonYears, b.sizingByUnits].every(sourced);
}

/** The city's basis, or null: no basis, or an incomplete one, means no payback sheet. */
export function costBasisFor(city: string): SolarCostBasis | null {
  const b = Object.hasOwn(SOLAR_COST, city) ? SOLAR_COST[city] : undefined;
  return b !== undefined && isComplete(b) ? b : null;
}
