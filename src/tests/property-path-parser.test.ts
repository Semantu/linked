import {parsePropertyPath, PathExpr} from '../paths/PropertyPathExpr';

describe('parsePropertyPath', () => {
  // ------ Simple paths ------

  it('parses a simple prefixed name', () => {
    expect(parsePropertyPath('ex:name')).toBe('ex:name');
  });

  it('parses a full IRI in angle brackets', () => {
    expect(parsePropertyPath('<http://example.org/name>')).toBe('http://example.org/name');
  });

  // ------ Sequence paths ------

  it('parses a sequence path', () => {
    expect(parsePropertyPath('ex:friend/ex:name')).toEqual({
      seq: ['ex:friend', 'ex:name'],
    });
  });

  it('parses a three-element sequence', () => {
    expect(parsePropertyPath('ex:a/ex:b/ex:c')).toEqual({
      seq: ['ex:a', 'ex:b', 'ex:c'],
    });
  });

  // ------ Alternative paths ------

  it('parses an alternative path', () => {
    expect(parsePropertyPath('ex:friend|ex:colleague')).toEqual({
      alt: ['ex:friend', 'ex:colleague'],
    });
  });

  it('parses a three-way alternative', () => {
    expect(parsePropertyPath('ex:a|ex:b|ex:c')).toEqual({
      alt: ['ex:a', 'ex:b', 'ex:c'],
    });
  });

  // ------ Inverse paths ------

  it('parses an inverse path', () => {
    expect(parsePropertyPath('^ex:parent')).toEqual({inv: 'ex:parent'});
  });

  it('parses double inverse', () => {
    expect(parsePropertyPath('^^ex:parent')).toEqual({inv: {inv: 'ex:parent'}});
  });

  // ------ Postfix operators ------

  it('parses zeroOrMore', () => {
    expect(parsePropertyPath('ex:broader*')).toEqual({zeroOrMore: 'ex:broader'});
  });

  it('parses oneOrMore', () => {
    expect(parsePropertyPath('ex:broader+')).toEqual({oneOrMore: 'ex:broader'});
  });

  it('parses zeroOrOne', () => {
    expect(parsePropertyPath('ex:middleName?')).toEqual({zeroOrOne: 'ex:middleName'});
  });

  // ------ Grouped expressions ------

  it('parses a grouped alternative in sequence', () => {
    expect(parsePropertyPath('(ex:friend|ex:colleague)/ex:name')).toEqual({
      seq: [{alt: ['ex:friend', 'ex:colleague']}, 'ex:name'],
    });
  });

  it('parses nested groups', () => {
    expect(parsePropertyPath('(ex:a/(ex:b|ex:c))')).toEqual({
      seq: ['ex:a', {alt: ['ex:b', 'ex:c']}],
    });
  });

  // ------ Negated property set ------

  it('parses a single negated property', () => {
    expect(parsePropertyPath('!ex:parent')).toEqual({
      negatedPropertySet: ['ex:parent'],
    });
  });

  it('parses a multi-item negated property set', () => {
    expect(parsePropertyPath('!(ex:parent|ex:child)')).toEqual({
      negatedPropertySet: ['ex:parent', 'ex:child'],
    });
  });

  it('parses negated property set with inverse', () => {
    expect(parsePropertyPath('!(ex:parent|^ex:child)')).toEqual({
      negatedPropertySet: ['ex:parent', {inv: 'ex:child'}],
    });
  });

  // ------ Operator precedence ------

  it('gives / higher precedence than |', () => {
    // ex:a/ex:b | ex:c  should be  alt(seq(a,b), c)
    expect(parsePropertyPath('ex:a/ex:b|ex:c')).toEqual({
      alt: [{seq: ['ex:a', 'ex:b']}, 'ex:c'],
    });
  });

  it('gives postfix higher precedence than /', () => {
    // ex:a/ex:b+  should be  seq(a, oneOrMore(b))
    expect(parsePropertyPath('ex:a/ex:b+')).toEqual({
      seq: ['ex:a', {oneOrMore: 'ex:b'}],
    });
  });

  it('gives ^ higher precedence than /', () => {
    // ^ex:a/ex:b  should be  seq(inv(a), b)
    expect(parsePropertyPath('^ex:a/ex:b')).toEqual({
      seq: [{inv: 'ex:a'}, 'ex:b'],
    });
  });

  // ------ Complex combinations ------

  it('parses (ex:a|^ex:b)/ex:c+', () => {
    expect(parsePropertyPath('(ex:a|^ex:b)/ex:c+')).toEqual({
      seq: [
        {alt: ['ex:a', {inv: 'ex:b'}]},
        {oneOrMore: 'ex:c'},
      ],
    });
  });

  it('parses ^ex:parent/ex:name with full IRIs', () => {
    expect(parsePropertyPath('<http://ex.org/parent>/<http://ex.org/name>')).toEqual({
      seq: ['http://ex.org/parent', 'http://ex.org/name'],
    });
  });

  // ------ Whitespace handling ------

  it('handles whitespace around operators', () => {
    expect(parsePropertyPath('ex:a / ex:b | ex:c')).toEqual({
      alt: [{seq: ['ex:a', 'ex:b']}, 'ex:c'],
    });
  });

  it('handles leading/trailing whitespace', () => {
    expect(parsePropertyPath('  ex:name  ')).toBe('ex:name');
  });

  // ------ Error cases ------

  it('throws on empty input', () => {
    expect(() => parsePropertyPath('')).toThrow('must not be empty');
  });

  it('throws on whitespace-only input', () => {
    expect(() => parsePropertyPath('   ')).toThrow('must not be empty');
  });

  it('throws on unmatched parenthesis', () => {
    expect(() => parsePropertyPath('(ex:a|ex:b')).toThrow("Expected ')'");
  });

  it('throws on trailing operator', () => {
    expect(() => parsePropertyPath('ex:a/')).toThrow();
  });

  it('throws on leading |', () => {
    expect(() => parsePropertyPath('|ex:a')).toThrow();
  });
});
