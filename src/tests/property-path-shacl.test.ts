import {serializePathToSHACL, resetBlankNodeCounter} from '../paths/serializePathToSHACL';
import type {PathExpr} from '../paths/PropertyPathExpr';

const SH = 'http://www.w3.org/ns/shacl#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

beforeEach(() => {
  resetBlankNodeCounter();
});

describe('serializePathToSHACL', () => {
  // ------ Simple predicate path ------

  it('serializes a simple string ref as direct IRI', () => {
    const result = serializePathToSHACL('ex:name');
    expect(result.root).toBe('ex:name');
    expect(result.triples).toEqual([]);
  });

  it('serializes an {id} ref as direct IRI', () => {
    const result = serializePathToSHACL({id: 'http://example.org/name'});
    expect(result.root).toBe('http://example.org/name');
    expect(result.triples).toEqual([]);
  });

  // ------ Sequence path ------

  it('serializes a sequence path as RDF list', () => {
    const expr: PathExpr = {seq: ['ex:friend', 'ex:name']};
    const result = serializePathToSHACL(expr);

    // Root is the first list node
    expect(result.root).toBe('_:b0');
    expect(result.triples).toEqual([
      {subject: '_:b0', predicate: `${RDF}first`, object: 'ex:friend'},
      {subject: '_:b0', predicate: `${RDF}rest`, object: '_:b1'},
      {subject: '_:b1', predicate: `${RDF}first`, object: 'ex:name'},
      {subject: '_:b1', predicate: `${RDF}rest`, object: `${RDF}nil`},
    ]);
  });

  // ------ Alternative path ------

  it('serializes an alternative path with sh:alternativePath', () => {
    const expr: PathExpr = {alt: ['ex:friend', 'ex:colleague']};
    const result = serializePathToSHACL(expr);

    // Root blank node with sh:alternativePath → RDF list
    expect(result.root).toBe('_:b0');
    expect(result.triples).toContainEqual({
      subject: '_:b1',
      predicate: `${RDF}first`,
      object: 'ex:friend',
    });
    expect(result.triples).toContainEqual({
      subject: '_:b0',
      predicate: `${SH}alternativePath`,
      object: '_:b1',
    });
  });

  // ------ Inverse path ------

  it('serializes an inverse path with sh:inversePath', () => {
    const expr: PathExpr = {inv: 'ex:parent'};
    const result = serializePathToSHACL(expr);

    expect(result.root).toBe('_:b0');
    expect(result.triples).toEqual([
      {subject: '_:b0', predicate: `${SH}inversePath`, object: 'ex:parent'},
    ]);
  });

  // ------ Repetition paths ------

  it('serializes zeroOrMore with sh:zeroOrMorePath', () => {
    const expr: PathExpr = {zeroOrMore: 'ex:broader'};
    const result = serializePathToSHACL(expr);

    expect(result.root).toBe('_:b0');
    expect(result.triples).toEqual([
      {subject: '_:b0', predicate: `${SH}zeroOrMorePath`, object: 'ex:broader'},
    ]);
  });

  it('serializes oneOrMore with sh:oneOrMorePath', () => {
    const expr: PathExpr = {oneOrMore: 'ex:broader'};
    const result = serializePathToSHACL(expr);

    expect(result.root).toBe('_:b0');
    expect(result.triples).toEqual([
      {subject: '_:b0', predicate: `${SH}oneOrMorePath`, object: 'ex:broader'},
    ]);
  });

  it('serializes zeroOrOne with sh:zeroOrOnePath', () => {
    const expr: PathExpr = {zeroOrOne: 'ex:middleName'};
    const result = serializePathToSHACL(expr);

    expect(result.root).toBe('_:b0');
    expect(result.triples).toEqual([
      {subject: '_:b0', predicate: `${SH}zeroOrOnePath`, object: 'ex:middleName'},
    ]);
  });

  // ------ Nested/complex paths ------

  it('serializes inverse within sequence', () => {
    // ^ex:parent / ex:name
    const expr: PathExpr = {seq: [{inv: 'ex:parent'}, 'ex:name']};
    const result = serializePathToSHACL(expr);

    // Root is the first RDF list node
    expect(result.root).toBe('_:b0');
    // The inverse produces a blank node
    expect(result.triples).toContainEqual({
      subject: '_:b1',
      predicate: `${SH}inversePath`,
      object: 'ex:parent',
    });
    // The list references the inverse blank node
    expect(result.triples).toContainEqual({
      subject: '_:b0',
      predicate: `${RDF}first`,
      object: '_:b1',
    });
  });

  it('serializes alternative within sequence', () => {
    // (ex:a | ex:b) / ex:c
    const expr: PathExpr = {seq: [{alt: ['ex:a', 'ex:b']}, 'ex:c']};
    const result = serializePathToSHACL(expr);

    // Should have an RDF list for the sequence, with first element being
    // a blank node for the alternative
    expect(result.root).toMatch(/^_:b/);
    expect(result.triples.length).toBeGreaterThan(0);
  });

  // ------ Negated property set (error) ------

  it('throws for negatedPropertySet', () => {
    const expr: PathExpr = {negatedPropertySet: ['ex:parent']};
    expect(() => serializePathToSHACL(expr)).toThrow(
      'negatedPropertySet cannot be serialized to SHACL',
    );
  });
});
