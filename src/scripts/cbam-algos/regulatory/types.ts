export type LegalStatus = 'enacted' | 'proposed_scenario'

export interface LegalSource {
  id: string
  title: string
  url: string
  sha256: string
  retrievedAt: string
  locator: string
  legalStatus: 'enacted' | 'proposal' | 'guidance'
}

export interface CnCodeVersion {
  id: string
  rulePackageId: string
  code: string
  nomenclatureYear: number
  description: string
  coverage: 'covered' | 'excluded'
  validFrom: string
  validTo: string | null
}

export interface DefaultFactorVersion {
  id: string
  rulePackageId: string
  scopeCode: string
  codeLevel: 2 | 4 | 6 | 8
  originCountry: string
  emissionsType: 'direct' | 'indirect'
  productionRoute: string
  reportingYear: number
  baseIntensity: string
  markupPct: string
  markedUpIntensity: string
  unit: 'tCO2e/t'
  sourceId: string
  sourceLocator: string
}

export interface DefaultFactorSelector {
  cnCode: string
  originCountry: string
  importDate: string
  emissionsType: 'direct' | 'indirect'
  productionRoute: string
  /**
   * Whether the Commission gives this origin its own sheet in the default-values workbook —
   * i.e. whether ANY factor exists for it in this package, for any good.
   *
   * This decides whether the residual "Other Countries and Territories" bucket may answer. It
   * CANNOT be derived from the rows loaded for one selector: a listed country with no value for
   * this particular good loads exactly like an unlisted one. The caller must state it (the
   * repository asks the database; the estimator checks the pack).
   */
  originIsListed: boolean
}

export interface RulePackage {
  id: string
  version: string
  legalStatus: LegalStatus
  isTestFixture: boolean
  validFrom: string
  validTo: string | null
  manifestSha256: string
  sources: LegalSource[]
  classifications: CnCodeVersion[]
  defaultFactors: DefaultFactorVersion[]
}
