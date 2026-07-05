/** Test helpers: scripted fetch mock that records every request. */
import { expect } from 'vitest';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | Uint8Array | null;
}

export interface ScriptedResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Match only requests whose URL contains this substring (else next script). */
  match?: string;
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/**
 * Build a fetch mock from an ordered script of responses. Each call consumes
 * the first script entry whose `match` (if any) is contained in the URL.
 */
export function scriptedFetch(script: ScriptedResponse[]) {
  const calls: RecordedRequest[] = [];
  const remaining = [...script];

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    let body: string | Uint8Array | null = null;
    if (typeof init?.body === 'string') body = init.body;
    else if (init?.body instanceof Uint8Array) body = init.body;
    calls.push({ url, method, headers, body });

    const idx = remaining.findIndex((s) => !s.match || url.includes(s.match));
    expect(idx, `unexpected fetch: ${method} ${url}`).toBeGreaterThanOrEqual(0);
    const [entry] = remaining.splice(idx, 1);
    return jsonResponse(entry.status ?? 200, entry.body ?? { success: true, data: {} }, entry.headers);
  }) as typeof globalThis.fetch;

  return { fetchImpl, calls };
}
