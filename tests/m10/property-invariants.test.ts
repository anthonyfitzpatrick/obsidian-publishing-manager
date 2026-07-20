/**
 * Exercises M10 properties over many deterministic examples. These checks deliberately use a
 * tiny seeded generator instead of ambient randomness: a failure must reproduce with the same
 * values on desktop, mobile-compatible CI, and a network-blocked test run.
 */
import { describe, expect, it } from 'vitest';

import { normalizeIsbn } from '../../src/domain/isbn/isbn-record';
import { normalizeDecimal as normalizePrice } from '../../src/domain/pricing/price-record';
import {
  evaluateReadiness,
  type ReadinessResultState,
  type ReadinessRule
} from '../../src/domain/readiness/readiness-engine';
import { normalizeSalesInput, salesKeys } from '../../src/domain/sales/sales-ledger';
import { findTaskDependencyCycle } from '../../src/domain/workflows/workflow';
import { JsonTestFrontmatterCodec } from '../storage-test-doubles';

/** Returns a repeatable unsigned sequence without using Math.random or host entropy. */
function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
}

/** Completes a 978 ISBN body with the check digit required by the ISBN-13 contract. */
function isbn13(body: string): string {
  const sum = [...body].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0
  );
  return `${body}${(10 - (sum % 10)) % 10}`;
}

describe('M10 deterministic domain properties', () => {
  it('normalizes every generated valid ISBN to the same canonical identity', () => {
    const next = sequence(0x10b5_0001);
    for (let example = 0; example < 256; example += 1) {
      const publisherDigits = String(next() % 1_000_000_000).padStart(9, '0');
      const canonical = isbn13(`978${publisherDigits}`);
      const presented = canonical.replace(/(978)(\d{3})(\d{3})(\d{3})(\d)/u, '$1-$2-$3-$4-$5');
      expect(normalizeIsbn(presented).isbn13).toBe(canonical);
      expect(normalizeIsbn(normalizeIsbn(presented).isbn13).isbn13).toBe(canonical);
    }
  });

  it('keeps money and sales normalization idempotent with stable exact-once keys', () => {
    const next = sequence(0x10b5_0002);
    for (let example = 0; example < 256; example += 1) {
      const whole = next() % 1_000_000;
      const fraction = String(next() % 10_000).padStart(4, '0');
      const amount = `${whole}.${fraction}00`;
      const normalizedAmount = normalizePrice(amount);
      expect(normalizePrice(normalizedAmount)).toBe(normalizedAmount);

      const normalized = normalizeSalesInput({
        sourceId: 'fictional-source',
        isbnId: 'pm-isbn-fictional-0001',
        editionId: 'pm-edition-fictional-0001',
        platformTargetId: 'pm-platform-fictional-0001',
        country: ' gb ',
        kind: 'transaction',
        startDate: '2028-02-29',
        endDate: '2028-02-29',
        units: next() % 10_000,
        returns: next() % 100,
        currency: ' gbp ',
        money: { proceeds: amount },
        sourceValues: { fixture: example }
      });
      const repeated = normalizeSalesInput(normalized);
      expect(repeated).toEqual(normalized);
      expect(salesKeys(repeated)).toEqual(salesKeys(normalized));
    }
  });

  it('accepts generated acyclic task graphs and identifies a deliberately closed cycle', () => {
    for (let size = 2; size <= 128; size += 1) {
      const chain = Array.from({ length: size }, (_, index) => ({
        id: `pm-task-property-${String(index).padStart(4, '0')}`,
        dependsOn: index === 0 ? [] : [`pm-task-property-${String(index - 1).padStart(4, '0')}`]
      }));
      expect(findTaskDependencyCycle(chain)).toBeUndefined();

      const closed = chain.map((task, index) =>
        index === 0 ? { ...task, dependsOn: [chain[size - 1]!.id] } : task
      );
      const cycle = findTaskDependencyCycle(closed);
      expect(cycle?.[0]).toBe(cycle?.[cycle.length - 1]);
      expect(new Set(cycle?.slice(0, -1)).size).toBe(size);
    }
  });

  it('round-trips generated structured frontmatter and body text without loss', () => {
    const codec = new JsonTestFrontmatterCodec();
    const next = sequence(0x10b5_0003);
    for (let example = 0; example < 128; example += 1) {
      const document = {
        frontmatter: {
          'pm-id': `pm-book-property-${String(example).padStart(4, '0')}`,
          title: `Fictional Unicode Book ${example} — Ångström 海`,
          values: [next() % 1000, next() % 1000, { enabled: example % 2 === 0 }]
        },
        body: `# Fictional body ${example}\n\nHuman-readable text remains byte stable.\n`
      };
      expect(codec.parse(codec.serialize(document))).toEqual(document);
    }
  });

  it('keeps readiness scores and confidence inside their documented bounds', () => {
    const next = sequence(0x10b5_0004);
    const states: readonly Exclude<ReadinessResultState, 'not-applicable'>[] = [
      'pass',
      'warning',
      'fail',
      'unknown'
    ];
    for (let example = 0; example < 256; example += 1) {
      const rules: ReadinessRule[] = Array.from({ length: 1 + (next() % 20) }, (_, index) => {
        const state = states[next() % states.length]!;
        return {
          code: `PROPERTY-${example}-${index}`,
          version: 1,
          inputKeys: [`fictional.${example}.${index}`],
          scopes: ['book'],
          weight: 1 + (next() % 100),
          severity: next() % 7 === 0 ? 'blocking' : 'required',
          applicability: () => next() % 5 !== 0,
          evaluate: () => ({ state, evidence: { summary: `Fictional ${state} evidence.` } })
        };
      });
      const result = evaluateReadiness(
        { code: 'PROPERTY', version: 1, rules },
        { scope: { kind: 'book', id: `fictional-book-${example}` }, inputs: {} },
        '2028-02-29T12:00:00.000Z'
      );
      if (result.score !== null) {
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
      }
      if (result.confidence !== null) {
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(100);
      }
    }
  });
});
