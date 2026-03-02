import {describe, expect, test} from '@jest/globals';
import {IRAliasScope, validateAliasReference} from '../queries/IRAliasScope';

describe('IR alias scope resolver (Phase 6)', () => {
  test('generates deterministic aliases within scope', () => {
    const root = new IRAliasScope('root');
    const a0 = root.generateAlias('shape:Person');
    const a1 = root.generateAlias('shape:Pet');

    expect(a0.alias).toBe('a0');
    expect(a1.alias).toBe('a1');
  });

  test('resolves aliases through lexical parent scope chain', () => {
    const root = new IRAliasScope('root');
    root.registerAlias('p', 'shape:Person');

    const child = root.createChildScope('subquery');
    const resolved = child.resolveAlias('p');

    expect(resolved.alias).toBe('p');
    expect(resolved.scopeDepth).toBe(0);
  });

  test('throws for missing alias in current+parent scopes', () => {
    const root = new IRAliasScope('root');
    const child = root.createChildScope('subquery');

    expect(() => validateAliasReference('missing', child)).toThrow(
      'Alias not found in scope chain: missing',
    );
  });

  test('throws for duplicate alias registration in same scope', () => {
    const root = new IRAliasScope('root');
    root.registerAlias('p', 'shape:Person');

    expect(() => root.registerAlias('p', 'shape:Pet')).toThrow(
      'Alias already exists in scope: p',
    );
  });
});
