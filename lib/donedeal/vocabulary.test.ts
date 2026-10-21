import { expect, test } from 'bun:test';
import { mentionsDamage } from './vocabulary';

test('clear damage denials do not exclude an otherwise comparable car', () => {
  for (const text of ['Never damaged.', 'No accident damage.', 'Not crashed or written off.', 'It has never been written off.', 'Not a write off.', 'City Emergency Breaking', 'Invoices for parts and labour.', 'Never been a Cat N or Cat S.']) {
    expect(mentionsDamage(text)).toBe(false);
  }
});

test('damage denials do not hide affirmative damage elsewhere', () => {
  for (const text of ['No accident damage, but non-runner.', 'Never crashed. Cat S repaired.', 'Not badly damaged.', 'No accident damage claimed; for parts only.', 'City Emergency Breaking. Sold for parts.', 'Not a write off. Cat S repaired.']) {
    expect(mentionsDamage(text)).toBe(true);
  }
});
