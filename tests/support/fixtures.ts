import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', 'fixtures', 'donedeal');

export function fixtureText(name: string): string {
  return readFileSync(join(root, name), 'utf8');
}

export function fixtureJson(name: string): unknown {
  return JSON.parse(fixtureText(name));
}
