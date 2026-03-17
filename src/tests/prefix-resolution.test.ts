import {Prefix} from '../utils/Prefix';
import {toNodeReference, resolvePrefixedUri} from '../utils/NodeReference';
import {normalizePropertyPath} from '../paths/normalizePropertyPath';
import {createPropertyShape} from '../shapes/SHACL';
import type {LiteralPropertyShapeConfig, ObjectPropertyShapeConfig} from '../shapes/SHACL';

// Register test prefixes before tests run
const FOAF_NS = 'http://xmlns.com/foaf/0.1/';
const XSD_NS = 'http://www.w3.org/2001/XMLSchema#';

beforeAll(() => {
  Prefix.add('foaf', FOAF_NS);
  Prefix.add('xsd', XSD_NS);
});

afterAll(() => {
  Prefix.delete('foaf');
  Prefix.delete('xsd');
});

// ---------------------------------------------------------------------------
// resolvePrefixedUri
// ---------------------------------------------------------------------------

describe('resolvePrefixedUri', () => {
  it('resolves a registered prefixed name to full IRI', () => {
    expect(resolvePrefixedUri('foaf:Person')).toBe(`${FOAF_NS}Person`);
  });

  it('resolves xsd prefix', () => {
    expect(resolvePrefixedUri('xsd:string')).toBe(`${XSD_NS}string`);
  });

  it('passes through full IRIs unchanged', () => {
    expect(resolvePrefixedUri('http://example.org/foo')).toBe('http://example.org/foo');
  });

  it('passes through strings without colons (plain IDs)', () => {
    expect(resolvePrefixedUri('plain-id')).toBe('plain-id');
  });

  it('passes through unregistered prefixes unchanged', () => {
    expect(resolvePrefixedUri('unknown:foo')).toBe('unknown:foo');
  });

  it('passes through URN-style strings unchanged', () => {
    expect(resolvePrefixedUri('urn:uuid:12345')).toBe('urn:uuid:12345');
  });
});

// ---------------------------------------------------------------------------
// toNodeReference — string inputs
// ---------------------------------------------------------------------------

describe('toNodeReference with prefix resolution', () => {
  it('resolves prefixed string to {id: fullIRI}', () => {
    expect(toNodeReference('foaf:Person')).toEqual({id: `${FOAF_NS}Person`});
  });

  it('wraps full IRI string in {id}', () => {
    expect(toNodeReference('http://example.org/foo')).toEqual({id: 'http://example.org/foo'});
  });

  it('wraps plain ID string in {id}', () => {
    expect(toNodeReference('my-entity-id')).toEqual({id: 'my-entity-id'});
  });

  it('passes through unregistered prefix unchanged', () => {
    expect(toNodeReference('unknown:bar')).toEqual({id: 'unknown:bar'});
  });

  // {id} inputs with prefix resolution
  it('resolves {id} with prefixed value', () => {
    expect(toNodeReference({id: 'foaf:Person'})).toEqual({id: `${FOAF_NS}Person`});
  });

  it('passes through {id} with full IRI', () => {
    expect(toNodeReference({id: 'http://example.org/foo'})).toEqual({id: 'http://example.org/foo'});
  });

  it('passes through {id} with plain value', () => {
    expect(toNodeReference({id: 'plain-id'})).toEqual({id: 'plain-id'});
  });
});

// ---------------------------------------------------------------------------
// normalizePropertyPath — prefix resolution in AST
// ---------------------------------------------------------------------------

describe('normalizePropertyPath with prefix resolution', () => {
  it('resolves a simple prefixed name to {id: fullIRI}', () => {
    expect(normalizePropertyPath('foaf:knows')).toEqual({id: `${FOAF_NS}knows`});
  });

  it('resolves prefixed names in a sequence path', () => {
    expect(normalizePropertyPath('foaf:knows/foaf:name')).toEqual({
      seq: [{id: `${FOAF_NS}knows`}, {id: `${FOAF_NS}name`}],
    });
  });

  it('resolves prefixed names in an alternative path', () => {
    expect(normalizePropertyPath('foaf:knows|foaf:name')).toEqual({
      alt: [{id: `${FOAF_NS}knows`}, {id: `${FOAF_NS}name`}],
    });
  });

  it('resolves prefixed names in an inverse path', () => {
    expect(normalizePropertyPath('^foaf:knows')).toEqual({
      inv: {id: `${FOAF_NS}knows`},
    });
  });

  it('resolves prefixed names in zeroOrMore', () => {
    expect(normalizePropertyPath('foaf:knows*')).toEqual({
      zeroOrMore: {id: `${FOAF_NS}knows`},
    });
  });

  it('resolves prefixed names in oneOrMore', () => {
    expect(normalizePropertyPath('foaf:knows+')).toEqual({
      oneOrMore: {id: `${FOAF_NS}knows`},
    });
  });

  it('resolves prefixed names in zeroOrOne', () => {
    expect(normalizePropertyPath('foaf:knows?')).toEqual({
      zeroOrOne: {id: `${FOAF_NS}knows`},
    });
  });

  it('resolves {id: prefixed} input', () => {
    expect(normalizePropertyPath({id: 'foaf:knows'})).toEqual({id: `${FOAF_NS}knows`});
  });

  it('resolves prefixed names in array input (sequence shorthand)', () => {
    expect(normalizePropertyPath(['foaf:knows', 'foaf:name'])).toEqual({
      seq: [{id: `${FOAF_NS}knows`}, {id: `${FOAF_NS}name`}],
    });
  });

  it('does not resolve unregistered prefixes', () => {
    expect(normalizePropertyPath('ex:name')).toBe('ex:name');
  });

  it('resolves complex mixed expression', () => {
    expect(normalizePropertyPath('(foaf:knows|^foaf:name)/foaf:mbox*')).toEqual({
      seq: [
        {alt: [{id: `${FOAF_NS}knows`}, {inv: {id: `${FOAF_NS}name`}}]},
        {zeroOrMore: {id: `${FOAF_NS}mbox`}},
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// createPropertyShape — integration with prefix resolution
// ---------------------------------------------------------------------------

describe('createPropertyShape with prefix resolution', () => {
  it('resolves prefixed path string', () => {
    const ps = createPropertyShape(
      {path: 'foaf:name'} as LiteralPropertyShapeConfig,
      'name',
    );
    expect(ps.path).toEqual({id: `${FOAF_NS}name`});
  });

  it('resolves prefixed path in sequence expression', () => {
    const ps = createPropertyShape(
      {path: 'foaf:knows/foaf:name'} as LiteralPropertyShapeConfig,
      'friendName',
    );
    expect(ps.path).toEqual({
      seq: [{id: `${FOAF_NS}knows`}, {id: `${FOAF_NS}name`}],
    });
  });

  it('resolves prefixed datatype string', () => {
    const ps = createPropertyShape(
      {path: 'foaf:name', datatype: 'xsd:string'} as LiteralPropertyShapeConfig,
      'name',
    );
    expect(ps.datatype).toEqual({id: `${XSD_NS}string`});
  });

  it('resolves prefixed class string', () => {
    const ps = createPropertyShape(
      {path: 'foaf:knows', class: 'foaf:Person'} as ObjectPropertyShapeConfig,
      'knows',
    );
    expect(ps.class).toEqual({id: `${FOAF_NS}Person`});
  });

  it('resolves prefixed equals constraint', () => {
    const ps = createPropertyShape(
      {path: 'foaf:name', equals: 'foaf:givenName'} as LiteralPropertyShapeConfig,
      'name',
    );
    expect(ps.equalsConstraint).toEqual({id: `${FOAF_NS}givenName`});
  });

  it('resolves prefixed disjoint constraint', () => {
    const ps = createPropertyShape(
      {path: 'foaf:name', disjoint: 'foaf:familyName'} as LiteralPropertyShapeConfig,
      'name',
    );
    expect(ps.disjoint).toEqual({id: `${FOAF_NS}familyName`});
  });

  it('resolves prefixed hasValue constraint', () => {
    const ps = createPropertyShape(
      {path: 'foaf:name', hasValue: 'foaf:Person'} as LiteralPropertyShapeConfig,
      'name',
    );
    expect(ps.hasValueConstraint).toEqual({id: `${FOAF_NS}Person`});
  });

  it('resolves prefixed strings in "in" array', () => {
    const ps = createPropertyShape(
      {path: 'foaf:name', in: ['foaf:Person', 'foaf:Agent']} as LiteralPropertyShapeConfig,
      'name',
    );
    expect(ps.in).toEqual([
      {id: `${FOAF_NS}Person`},
      {id: `${FOAF_NS}Agent`},
    ]);
  });

  it('resolves mixed strings and {id} objects in "in" array', () => {
    const ps = createPropertyShape(
      {path: 'foaf:name', in: ['foaf:Person', {id: 'foaf:Agent'}]} as LiteralPropertyShapeConfig,
      'name',
    );
    expect(ps.in).toEqual([
      {id: `${FOAF_NS}Person`},
      {id: `${FOAF_NS}Agent`},
    ]);
  });

  it('resolves {id} objects with prefixed values in "in" array', () => {
    const ps = createPropertyShape(
      {path: 'foaf:name', in: [{id: 'foaf:Person'}, {id: `${FOAF_NS}Agent`}]} as LiteralPropertyShapeConfig,
      'name',
    );
    expect(ps.in).toEqual([
      {id: `${FOAF_NS}Person`},
      {id: `${FOAF_NS}Agent`},
    ]);
  });

  it('resolves prefixed sortBy path', () => {
    const ps = createPropertyShape(
      {path: 'foaf:name', sortBy: 'foaf:familyName'} as LiteralPropertyShapeConfig,
      'name',
    );
    expect(ps.sortBy).toEqual({id: `${FOAF_NS}familyName`});
  });
});
