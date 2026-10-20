export function byClassPrefix(prefix: string): string {
  return `[class^="${prefix}"], [class*=" ${prefix}"]`;
}

export function readNextData(doc: Document): unknown {
  const raw = doc.getElementById('__NEXT_DATA__')?.textContent;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
