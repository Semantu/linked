import {Prefix} from '../utils/Prefix';
import {toNodeReference, resolvePrefixedUri} from '../utils/NodeReference';

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
// toNodeReference — simple wrap, no prefix resolution
// ---------------------------------------------------------------------------

describe('toNodeReference (simple wrap)', () => {
  it('wraps string in {id} without resolving prefixes', () => {
    expect(toNodeReference('foaf:Person')).toEqual({id: 'foaf:Person'});
  });

  it('wraps full IRI string in {id}', () => {
    expect(toNodeReference('http://example.org/foo')).toEqual({id: 'http://example.org/foo'});
  });

  it('wraps plain ID string in {id}', () => {
    expect(toNodeReference('my-entity-id')).toEqual({id: 'my-entity-id'});
  });

  it('passes through {id} with prefixed value unchanged', () => {
    expect(toNodeReference({id: 'foaf:Person'})).toEqual({id: 'foaf:Person'});
  });

  it('passes through {id} with full IRI', () => {
    expect(toNodeReference({id: 'http://example.org/foo'})).toEqual({id: 'http://example.org/foo'});
  });
});
