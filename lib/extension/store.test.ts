import { expect, test } from 'bun:test';
import { memoryArea, NOW } from '../../tests/support/extension';
import { createStore } from './store';

test.each([
  { version: 1, generation: 0, entries: [{ description: 'Old cached evidence' }] },
  { version: 2, generation: 99, entries: [] },
  { corrupted: true, evidence: 'Old cached evidence' },
])('removes incompatible stored assessments even while analysis is disabled', async (stored) => {
  const local = memoryArea();
  local.data.set('tyrekick.assessments', stored);
  const store = createStore({ local, session: memoryArea(), now: () => NOW });
  const snapshot = await store.snapshot();
  expect(snapshot.cache).toEqual({ version: 2, generation: 0, entries: [] });
  expect(local.data.get('tyrekick.assessments')).toEqual(snapshot.cache);
});
