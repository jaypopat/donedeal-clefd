/** Provider spans and stored evidence offsets count Unicode codepoints, not UTF-16 units. */
export function codepointSlice(text: string, start: number, end: number): string {
  return Array.from(text).slice(start, end).join('');
}

export function codepointLength(text: string): number {
  return Array.from(text).length;
}
