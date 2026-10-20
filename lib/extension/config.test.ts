import { expect, test } from 'bun:test';
import { localApiBase } from './config';

test('local development can choose a free loopback port', () => {
  expect(localApiBase(undefined)).toBe('http://127.0.0.1:8787');
  expect(localApiBase('http://127.0.0.1:8791')).toBe('http://127.0.0.1:8791');
  expect(localApiBase('http://localhost:8791/')).toBe('http://localhost:8791');
});

test('build configuration rejects external endpoints and hidden URL components', () => {
  for (const value of ['https://example.com', 'http://127.0.0.1.example.com', 'https://127.0.0.1', 'http://user:secret@127.0.0.1', 'http://127.0.0.1/api', 'http://127.0.0.1?token=x', 'http://127.0.0.1#x']) {
    expect(() => localApiBase(value)).toThrow();
  }
});
