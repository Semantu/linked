import {normalizePropertyPath, getSimplePathId} from '../paths/normalizePropertyPath';

describe('normalizePropertyPath', () => {
  // ------ String inputs ------

  it('preserves a simple prefixed name string', () => {
    expect(normalizePropertyPath('ex:name')).toBe('ex:name');
  });

  it('parses a string with sequence operator', () => {
    expect(normalizePropertyPath('ex:friend/ex:name')).toEqual({
      seq: ['ex:friend', 'ex:name'],
    });
  });

  it('parses a string with alternative operator', () => {
    expect(normalizePropertyPath('ex:a|ex:b')).toEqual({
      alt: ['ex:a', 'ex:b'],
    });
  });

  it('parses a string with inverse operator', () => {
    expect(normalizePropertyPath('^ex:parent')).toEqual({inv: 'ex:parent'});
  });

  it('parses a string with postfix operators', () => {
    expect(normalizePropertyPath('ex:broader+')).toEqual({oneOrMore: 'ex:broader'});
  });

  it('parses a complex string expression', () => {
    expect(normalizePropertyPath('(ex:a|^ex:b)/ex:c*')).toEqual({
      seq: [
        {alt: ['ex:a', {inv: 'ex:b'}]},
        {zeroOrMore: 'ex:c'},
      ],
    });
  });

  // ------ {id} inputs ------

  it('preserves {id: string} as PathRef', () => {
    expect(normalizePropertyPath({id: 'http://example.org/name'})).toEqual({
      id: 'http://example.org/name',
    });
  });

  // ------ Array inputs (sequence shorthand) ------

  it('converts array to seq', () => {
    expect(
      normalizePropertyPath([{id: 'http://ex.org/a'}, {id: 'http://ex.org/b'}]),
    ).toEqual({
      seq: [{id: 'http://ex.org/a'}, {id: 'http://ex.org/b'}],
    });
  });

  it('unwraps single-element array', () => {
    expect(normalizePropertyPath([{id: 'http://ex.org/a'}])).toEqual({
      id: 'http://ex.org/a',
    });
  });

  it('handles mixed string and {id} in array', () => {
    expect(normalizePropertyPath(['ex:a', {id: 'http://ex.org/b'}])).toEqual({
      seq: ['ex:a', {id: 'http://ex.org/b'}],
    });
  });

  it('recursively normalizes array elements with operators', () => {
    expect(normalizePropertyPath(['^ex:parent', 'ex:name'])).toEqual({
      seq: [{inv: 'ex:parent'}, 'ex:name'],
    });
  });

  // ------ PathExpr object inputs (passthrough) ------

  it('passes through a seq PathExpr', () => {
    const expr = {seq: ['ex:a', 'ex:b']};
    expect(normalizePropertyPath(expr)).toBe(expr);
  });

  it('passes through an alt PathExpr', () => {
    const expr = {alt: ['ex:a', 'ex:b']};
    expect(normalizePropertyPath(expr)).toBe(expr);
  });

  it('passes through an inv PathExpr', () => {
    const expr = {inv: 'ex:parent'};
    expect(normalizePropertyPath(expr)).toBe(expr);
  });

  it('passes through a zeroOrMore PathExpr', () => {
    const expr = {zeroOrMore: 'ex:broader'};
    expect(normalizePropertyPath(expr)).toBe(expr);
  });

  it('passes through a negatedPropertySet PathExpr', () => {
    const expr = {negatedPropertySet: ['ex:a', 'ex:b']};
    expect(normalizePropertyPath(expr)).toBe(expr);
  });

  // ------ Error cases ------

  it('throws on null input', () => {
    expect(() => normalizePropertyPath(null as any)).toThrow('Invalid property path input');
  });

  it('throws on number input', () => {
    expect(() => normalizePropertyPath(42 as any)).toThrow('Invalid property path input');
  });
});

describe('getSimplePathId', () => {
  it('returns string from a string PathRef', () => {
    expect(getSimplePathId('ex:name')).toBe('ex:name');
  });

  it('returns id from an {id} PathRef', () => {
    expect(getSimplePathId({id: 'http://example.org/name'})).toBe('http://example.org/name');
  });

  it('returns null for a complex PathExpr', () => {
    expect(getSimplePathId({seq: ['ex:a', 'ex:b']})).toBeNull();
  });

  it('returns null for inv PathExpr', () => {
    expect(getSimplePathId({inv: 'ex:a'})).toBeNull();
  });
});
