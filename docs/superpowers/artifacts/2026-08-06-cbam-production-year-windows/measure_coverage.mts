// Drives the real vendored engine over (a) the shipped pack and (b) the same pack
// with the regenerated benchmark rows spliced in, and reports how many catalogue
// goods become priceable. The engine is unmodified — only the data differs.
import { readFileSync } from 'node:fs'
import { estimateFromPack, routesFor } from '/Volumes/VSTSAMPLES/Projects/Angad/src/scripts/cbam-algos/estimator/estimate-from-pack.ts'

const SCRATCH = '/private/tmp/claude-501/-Volumes-VSTSAMPLES-Projects-Angad/4cfc08a6-a969-440b-92fa-7eb9e10fc4de/scratchpad/cbam-fix'
const shipped = JSON.parse(readFileSync('/Volumes/VSTSAMPLES/Projects/Angad/public/cbam/estimator-pack.json', 'utf8'))
const regenerated = JSON.parse(readFileSync(`${SCRATCH}/golden/rule-packages/eu-cbam-2026-free-allocation.json`, 'utf8'))

const fixed = { ...shipped, benchmarks: regenerated.benchmarks }

function sweep(pack: any, year: number, date: string) {
  const codes: string[] = pack.classifications.map((c: any) => c.code)
  const priced = new Set<string>(), dead = new Set<string>()
  for (const cn of codes) for (const origin of ['IN', 'CN', 'TR', 'UA', 'BR']) {
    for (const route of routesFor(pack, cn, origin, year)) {
      try {
        const e: any = estimateFromPack(pack, { cn, country: origin, route, massT: '100', date })
        ;(e.status === 'unavailable' ? dead : priced).add(cn)
      } catch { /* counted as not-priced */ }
    }
  }
  return { priced: priced.size, dead: [...dead].filter(c => !priced.has(c)).length }
}

const before = sweep(shipped, 2026, '2026-03-01')
const after = sweep(fixed, 2026, '2026-03-01')
console.log('2026 imports, 574 catalogue CN codes x 5 origins')
console.log(`  BEFORE  priceable=${before.priced}  never-priceable=${before.dead}`)
console.log(`  AFTER   priceable=${after.priced}  never-priceable=${after.dead}`)
console.log(`  DELTA   +${after.priced - before.priced} goods`)
