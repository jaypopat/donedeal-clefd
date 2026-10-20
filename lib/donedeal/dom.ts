/** Matches a styled-components class such as `Card-styled__Container-sc-b6c81d2b-0`. */
export function byClassPrefix(prefix: string): string {
  return `[class^="${prefix}"], [class*=" ${prefix}"]`;
}

/** Parses the page's embedded Next.js data. The caller keeps only allowlisted fields. */
export function readNextData(doc: Document): unknown {
  const raw = doc.getElementById('__NEXT_DATA__')?.textContent;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
