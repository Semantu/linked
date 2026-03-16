import {pathExprToSparql} from '../paths/pathExprToSparql';
import type {PathExpr} from '../paths/PropertyPathExpr';

describe('pathExprToSparql', () => {
  // ------ Simple refs ------

  it('renders a prefixed name', () => {
    expect(pathExprToSparql('ex:name')).toBe('ex:name');
  });

  it('renders a full IRI string in angle brackets', () => {
    expect(pathExprToSparql('http://example.org/name')).toBe('<http://example.org/name>');
  });

  it('renders an {id} ref in angle brackets', () => {
    expect(pathExprToSparql({id: 'http://example.org/name'})).toBe('<http://example.org/name>');
  });

  // ------ Sequence ------

  it('renders a sequence path', () => {
    expect(pathExprToSparql({seq: ['ex:friend', 'ex:name']})).toBe('ex:friend/ex:name');
  });

  it('renders a three-element sequence', () => {
    expect(pathExprToSparql({seq: ['ex:a', 'ex:b', 'ex:c']})).toBe('ex:a/ex:b/ex:c');
  });

  // ------ Alternative ------

  it('renders an alternative path', () => {
    expect(pathExprToSparql({alt: ['ex:friend', 'ex:colleague']})).toBe('ex:friend|ex:colleague');
  });

  // ------ Inverse ------

  it('renders an inverse path', () => {
    expect(pathExprToSparql({inv: 'ex:parent'})).toBe('^ex:parent');
  });

  it('renders inverse of full IRI', () => {
    expect(pathExprToSparql({inv: {id: 'http://example.org/parent'}})).toBe('^<http://example.org/parent>');
  });

  // ------ Repetition ------

  it('renders zeroOrMore', () => {
    expect(pathExprToSparql({zeroOrMore: 'ex:broader'})).toBe('ex:broader*');
  });

  it('renders oneOrMore', () => {
    expect(pathExprToSparql({oneOrMore: 'ex:broader'})).toBe('ex:broader+');
  });

  it('renders zeroOrOne', () => {
    expect(pathExprToSparql({zeroOrOne: 'ex:middleName'})).toBe('ex:middleName?');
  });

  // ------ Negated property set ------

  it('renders single negated property', () => {
    expect(pathExprToSparql({negatedPropertySet: ['ex:parent']})).toBe('!ex:parent');
  });

  it('renders multi-item negated property set', () => {
    expect(pathExprToSparql({negatedPropertySet: ['ex:parent', 'ex:child']})).toBe('!(ex:parent|ex:child)');
  });

  it('renders negated property set with inverse', () => {
    expect(pathExprToSparql({negatedPropertySet: ['ex:parent', {inv: 'ex:child'}]})).toBe('!(ex:parent|^ex:child)');
  });

  // ------ Precedence / grouping ------

  it('parenthesizes alt within seq', () => {
    // (ex:a | ex:b) / ex:c
    const expr: PathExpr = {seq: [{alt: ['ex:a', 'ex:b']}, 'ex:c']};
    expect(pathExprToSparql(expr)).toBe('(ex:a|ex:b)/ex:c');
  });

  it('does not parenthesize seq within alt', () => {
    // ex:a/ex:b | ex:c  — seq binds tighter than alt
    const expr: PathExpr = {alt: [{seq: ['ex:a', 'ex:b']}, 'ex:c']};
    expect(pathExprToSparql(expr)).toBe('ex:a/ex:b|ex:c');
  });

  it('parenthesizes seq under postfix operator', () => {
    // (ex:a / ex:b)*
    const expr: PathExpr = {zeroOrMore: {seq: ['ex:a', 'ex:b']}};
    expect(pathExprToSparql(expr)).toBe('(ex:a/ex:b)*');
  });

  it('parenthesizes alt under postfix operator', () => {
    // (ex:a | ex:b)+
    const expr: PathExpr = {oneOrMore: {alt: ['ex:a', 'ex:b']}};
    expect(pathExprToSparql(expr)).toBe('(ex:a|ex:b)+');
  });

  // ------ Complex combinations ------

  it('renders (ex:a|^ex:b)/ex:c+', () => {
    const expr: PathExpr = {
      seq: [
        {alt: ['ex:a', {inv: 'ex:b'}]},
        {oneOrMore: 'ex:c'},
      ],
    };
    expect(pathExprToSparql(expr)).toBe('(ex:a|^ex:b)/ex:c+');
  });

  it('renders ^ex:parent/ex:name', () => {
    const expr: PathExpr = {seq: [{inv: 'ex:parent'}, 'ex:name']};
    expect(pathExprToSparql(expr)).toBe('^ex:parent/ex:name');
  });

  it('renders full IRI sequence', () => {
    const expr: PathExpr = {
      seq: [
        {id: 'http://example.org/friend'},
        {id: 'http://example.org/name'},
      ],
    };
    expect(pathExprToSparql(expr)).toBe('<http://example.org/friend>/<http://example.org/name>');
  });
});

describe('pathExprToSparql with IRTraversePattern integration', () => {
  // These tests verify that the pathExprToSparql output is correct
  // for use as a SPARQL property path predicate in triple patterns.
  // The integration with irToAlgebra is tested indirectly via the
  // IRTraversePattern.pathExpr → SparqlTerm {kind: 'path'} flow.

  it('produces valid SPARQL for inverse traversal', () => {
    const sparql = pathExprToSparql({inv: {id: 'http://ex.org/parent'}});
    expect(sparql).toBe('^<http://ex.org/parent>');
    // This would appear in SPARQL as: ?a0 ^<http://ex.org/parent> ?a1
  });

  it('produces valid SPARQL for alternative traversal', () => {
    const sparql = pathExprToSparql({
      alt: [{id: 'http://ex.org/friend'}, {id: 'http://ex.org/colleague'}],
    });
    expect(sparql).toBe('<http://ex.org/friend>|<http://ex.org/colleague>');
  });

  it('produces valid SPARQL for zero-or-more with IRI', () => {
    const sparql = pathExprToSparql({zeroOrMore: {id: 'http://ex.org/broader'}});
    expect(sparql).toBe('<http://ex.org/broader>*');
  });
});
