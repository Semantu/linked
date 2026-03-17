import {Prefix} from '../utils/Prefix';
import {toNodeReference, resolvePrefixedUri} from '../utils/NodeReference';
import {normalizePropertyPath} from '../paths/normalizePropertyPath';

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
