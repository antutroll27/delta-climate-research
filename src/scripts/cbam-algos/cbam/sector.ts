import type { ImportSector } from '../threshold/aggregate'

/**
 * The CBAM sector a CN code belongs to — the grouping Annex I of Reg (EU) 2023/956 uses, and the
 * one the 50 t threshold's `includedSectors` is expressed in.
 *
 * Deliberately keyed on HEADING (4 digits), not chapter. Chapter 28 alone spans two sectors:
 * 2804 10 is hydrogen while 2808 / 2814 / 2834 are the nitrogen chemicals that sit in the
 * fertilisers sector. A chapter-level map would file ammonia under hydrogen and silently apply
 * the wrong sector's threshold.
 *
 * Returns null for anything not listed rather than guessing. A null sector makes the threshold
 * INDETERMINATE (see resolveThreshold), never "exempt" — being unable to classify a good is not
 * evidence that it falls below a threshold.
 *
 * Distinct from `sectorFromCnCode` in lib/signals/config.ts, which maps only the two sectors the
 * anti-circumvention signal profiles and is not a regulatory classification.
 */
const HEADING_SECTOR: Record<string, ImportSector> = {
  // Cement — Annex I cement sector
  '2507': 'cement',
  '2523': 'cement',
  // Iron & steel — sintered iron ore sits with the steel sector, not with minerals
  '2601': 'iron_and_steel',
  // Hydrogen
  '2804': 'hydrogen',
  // Fertilisers — nitric acid, ammonia, nitrates, and the mineral fertilisers themselves
  '2808': 'fertilisers',
  '2814': 'fertilisers',
  '2834': 'fertilisers',
  '3102': 'fertilisers',
  '3105': 'fertilisers',
  // Electricity
  '2716': 'electricity',
}

export function sectorForCn(cnCode: string): ImportSector | null {
  const heading = cnCode.slice(0, 4)
  if (HEADING_SECTOR[heading]) return HEADING_SECTOR[heading]
  const chapter = cnCode.slice(0, 2)
  // Chapters 72/73 and 76 are unambiguously iron & steel and aluminium in the Harmonised System,
  // so a chapter rule is safe HERE in a way it is not for chapter 28.
  if (chapter === '72' || chapter === '73') return 'iron_and_steel'
  if (chapter === '76') return 'aluminium'
  return null
}
