/**
 * The one way the local-air adapters ask a government server for something: a generic
 * User-Agent (never an address of ours), a hard timeout, a size cap, and a typed failure.
 * `fetch` is injected so tests replay recorded responses and never touch the network.
 */
export const USER_AGENT = 'obos-pipeline/1.0 (+https://deltaclimate.earth)';
export const REQUEST_TIMEOUT_MS = 8_000;
const MAX_BYTES = 1_500_000;

export class SourceError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'SourceError';
    this.status = status;
  }
}

export type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;

/** GET `url` and return its text. Throws SourceError for any non-200, timeout, network fault or oversize body. */
export async function getText(url: string, fetchImpl: Fetch, signal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Awaited<ReturnType<Fetch>>;
  try {
    res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: '*/*' }, signal: sig });
  } catch {
    throw new SourceError(0, 'network or timeout');
  }
  if (!res.ok) throw new SourceError(res.status, `HTTP ${res.status}`);
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new SourceError(0, 'body unreadable');
  }
  if (text.length > MAX_BYTES) throw new SourceError(0, 'body too large');
  return text;
}
