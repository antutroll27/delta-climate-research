import {
  PackValidationError,
  prepareEstimatorPack,
  validateEstimatorPack,
  type LoadedEstimatorPack,
} from './pack-v2'

export interface PackIntegrity {
  schemaVersion: 1
  algorithm: 'sha256'
  packSha256: string
  generatedAt: string
}

export async function sha256HexBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function loadEstimatorPack(
  packUrl: string,
  integrity: PackIntegrity,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<LoadedEstimatorPack> {
  const packResponse = await fetcher(packUrl, { cache: 'no-cache' })
  if (!packResponse.ok) throw new Error(`PACK_FETCH_${packResponse.status}`)

  if (
    integrity.schemaVersion !== 1 ||
    integrity.algorithm !== 'sha256' ||
    !/^[0-9a-f]{64}$/.test(integrity.packSha256)
  ) throw new PackValidationError(['bundled pack integrity has an unsupported shape'])

  // Hash the exact response bytes before decoding. Response.text() followed by
  // TextEncoder would normalise malformed UTF-8/BOM details and would therefore
  // be a digest of reconstructed text, not the served artefact.
  const bytes = await packResponse.arrayBuffer()
  const packSha256 = await sha256HexBytes(bytes)
  if (packSha256 !== integrity.packSha256) {
    throw new PackValidationError([
      `pack content SHA-256 mismatch: expected ${integrity.packSha256}, got ${packSha256}`,
    ])
  }

  let parsed: unknown
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new PackValidationError([
      `pack is not valid UTF-8 JSON${cause instanceof Error ? `: ${cause.message}` : ''}`,
    ])
  }

  const pack = validateEstimatorPack(parsed)
  if (pack.generatedAt !== integrity.generatedAt) {
    throw new PackValidationError(['pack generatedAt does not match its bundled integrity record'])
  }
  return { pack, packSha256, prepared: prepareEstimatorPack(pack) }
}
