export function localApiBase(value: string | undefined): string {
  const url = new URL(value ?? 'http://127.0.0.1:8787');
  if (
    url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash
  ) throw new Error('WXT_API_BASE must be a loopback HTTP origin, such as http://127.0.0.1:8791');
  return url.origin;
}

export const API_BASE = localApiBase(import.meta.env.WXT_API_BASE);
