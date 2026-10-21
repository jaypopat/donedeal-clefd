import { describe, expect, test } from 'bun:test';
import type { Transmission } from '../contracts/listing';
import { readIdentity } from './identity';

function identify(title: string, model = 'Golf', trim: string | null = null, transmission: Transmission | null = null, year: number | null = 2018) {
  return readIdentity({ title, trim, listed: { make: model === 'Aqua' ? 'Toyota' : 'Volkswagen', model, transmission, year }, corroborate: null });
}

describe('evidenced vehicle identity', () => {
  test.each([
    ['Volkswagen Golf GTI', 'gti'], ['gtd-golf', 'gtd'], ['Golf GTE', 'gte'],
    ['Golf R', 'r'], ['Golf R32', 'r'], ['Golf R-Line', 'r_line'], ['GT Sport R Line', 'r_line'],
  ] as const)('%s has a distinct material variant', (title, code) => {
    expect(identify(title).variant).toEqual({ kind: 'marked', code, source: 'title' });
  });

  test.each(['Aqua Gsports', 'Aqua GS sport', 'Aqua GS /Spec', "Aqua G's", 'Aqua G-Sports'])('%s marks GS', (title) => {
    expect(identify(title, 'Aqua').variant).toMatchObject({ kind: 'marked', code: 'gs' });
  });

  test('GS, GR Sport, G Smart and unmarked are never conflated', () => {
    expect(identify('Aqua GR Sport', 'Aqua').variant).toMatchObject({ kind: 'marked', code: 'gr_sport' });
    for (const title of ['Aqua G Smart', 'Aqua S', 'Aqua']) expect(identify(title, 'Aqua').variant).toEqual({ kind: 'unmarked', source: 'title' });
    expect(identify('Golf').variant).toEqual({ kind: 'unmarked', source: 'title' });
    expect(identify('VW Passat', 'Passat').variant).toEqual({ kind: 'not_catalogued' });
  });

  test('conflicting title and trim markers stay ambiguous', () => {
    expect(identify('Golf GTI GTD').variant).toEqual({ kind: 'ambiguous' });
    expect(identify('Golf R-Line', 'Golf', 'R').variant).toEqual({ kind: 'ambiguous' });
    expect(identify('Golf', 'Golf', 'GTI').variant).toEqual({ kind: 'marked', code: 'gti', source: 'trim' });
    expect(identify('Aqua GS GR Sport', 'Aqua').variant).toEqual({ kind: 'ambiguous' });
  });

  test.each(['auto lights', 'automatic lights', 'auto wipers', 'auto hold', 'auto sales', 'semi-auto', 'manual with DSG'])('%s does not guess a gearbox', (title) => {
    expect(identify(title).transmission).toBeNull();
    expect(identify(title).titleEvidence.recovered).toEqual([]);
  });

  test.each(['automatic', 'AUTO', 'DSG', 'CVT'])('recovers explicit %s gearbox evidence', (title) => {
    expect(identify(title)).toMatchObject({ transmission: 'automatic', titleEvidence: { recovered: ['transmission'], conflicts: [] } });
  });

  test('keeps a listed gearbox and records contrary or ambiguous title evidence', () => {
    for (const title of ['Golf Automatic', 'Golf manual DSG']) {
      expect(identify(title, 'Golf', null, 'manual')).toMatchObject({ transmission: 'manual', titleEvidence: { recovered: [], conflicts: ['transmission'] } });
    }
  });

  test('recovers make and model only with explicit title corroboration of verified context', () => {
    const read = (title: string) => readIdentity({ title, trim: null, listed: { make: null, model: null, transmission: null, year: null }, corroborate: { make: 'Volkswagen', model: 'Golf' } });
    expect(read('2018 VW Golf DSG')).toMatchObject({ make: 'Volkswagen', model: 'Golf', transmission: 'automatic', titleEvidence: { recovered: ['make', 'model', 'transmission'], conflicts: [] } });
    for (const title of ['Ford Fiesta', 'Golf', 'VW', 'Volkswagen Golf Polo']) expect(read(title)).toMatchObject({ make: null, model: null });
    expect(readIdentity({ title: 'VW Golf', trim: null, listed: { make: null, model: null, transmission: null, year: null }, corroborate: null })).toMatchObject({ make: null, model: null });
  });

  test('a known title identity contradicting structured identity is recorded', () => {
    expect(identify('Volkswagen Polo')).toMatchObject({ model: 'Golf', titleEvidence: { recovered: [], conflicts: ['model'] } });
    expect(identify('Polo')).toMatchObject({ model: 'Golf', titleEvidence: { recovered: [], conflicts: ['model'] } });
    expect(identify('Toyota Aqua')).toMatchObject({ titleEvidence: { conflicts: ['make', 'model'] } });
  });

  test('recognises contrary makes independently of material-variant catalog coverage', () => {
    for (const title of ['Ford Focus 1.6 Diesel', 'Audi A4', 'BMW 320d', 'Peugeot 308', '2018 SEAT Leon']) {
      expect(identify(title).titleEvidence.conflicts).toContain('make');
    }
  });

  test('ordinary seat and mini-spare features are not contrary makes', () => {
    for (const title of ['Volkswagen Golf heated driver seat', 'Golf with mini spare wheel']) {
      expect(identify(title).titleEvidence.conflicts).toEqual([]);
    }
  });

  test('make accents do not create a contrary-make claim', () => {
    for (const example of [{ make: 'Citroën', title: 'Citroen C4' }, { make: 'Skoda', title: 'Škoda Octavia' }]) {
      expect(readIdentity({ title: example.title, trim: null, corroborate: null, listed: { make: example.make, model: 'Example', transmission: null, year: null } }).titleEvidence.conflicts).toEqual([]);
    }
  });

  test('recognises the captured Golf R title with engine text between model and variant', () => {
    expect(identify('Volkswagen Golf 2.0 TSI R 4MOTION 320PS 5 5DR AUTO').variant).toMatchObject({ kind: 'marked', code: 'r' });
    expect(identify('Volkswagen Golf 2.0 TDI R-Line').variant).toMatchObject({ kind: 'marked', code: 'r_line' });
    expect(identify("VW Golf 1.5 TSI 'R' Line").variant).toMatchObject({ kind: 'marked', code: 'r_line' });
    expect(identify('VW Golf 1.5 TSI R/Line').variant).toMatchObject({ kind: 'marked', code: 'r_line' });
  });

  test('one explicit title year can contradict a known year without replacing it', () => {
    expect(identify('VOKSWAGEN GOLF 1.2 TSI AUTO 2017', 'Golf', null, null, 2015)).toMatchObject({
      year: 2015, titleEvidence: { recovered: ['transmission'], conflicts: ['year'] },
    });
    expect(identify('Golf 2015', 'Golf', null, null, 2015)).toMatchObject({ year: 2015, titleEvidence: { conflicts: [] } });
    expect(identify('2017 VW Golf 1.2 TSI', 'Golf', null, null, 2015).titleEvidence.conflicts).toEqual(['year']);
    expect(identify('Golf 2017', 'Golf', null, null, null)).toMatchObject({ year: null, titleEvidence: { recovered: [], conflicts: [] } });
  });

  test.each([
    'Golf NCT 2027', 'Golf NCT until 2027', 'Golf 2027 NCT', 'Golf NCT 19/03/2027', 'Golf NCT March 2027',
    'Golf NCT 03/2027', 'Golf 2027-03-19', 'Golf 19.03.2027', 'Golf 2015 2017',
    'Golf 2017/2018', 'Golf 151-D-1234', 'Golf 2017-D-1234', 'Golf 2017 km', 'Golf €2017',
  ])('%s does not invent a vehicle year conflict from a date, ambiguous years or registration', (title) => {
    expect(identify(title, 'Golf', null, null, 2015)).toMatchObject({ year: 2015, titleEvidence: { recovered: [], conflicts: [] } });
  });

  test('a vehicle year stays explicit when an NCT date is also present', () => {
    expect(identify('Golf 2017 NCT 03/2027', 'Golf', null, null, 2015).titleEvidence.conflicts).toEqual(['year']);
    expect(identify('Golf 2017 NCT 2027', 'Golf', null, null, 2015).titleEvidence.conflicts).toEqual(['year']);
  });
});
