import {describe, expect, test, beforeAll, afterAll} from '@jest/globals';
import {Prefix} from '../utils/Prefix';
import {
  formatUri,
  formatLiteral,
  escapeSparqlString,
  collectPrefixes,
  generateEntityUri,
} from '../sparql/sparqlUtils';

// Ensure rdf and xsd prefixes are registered (importing the ontology modules does this)
import '../ontologies/rdf';
import '../ontologies/xsd';

describe('formatUri', () => {
  test('given a URI with a registered prefix, returns prefixed form', () => {
    expect(formatUri('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')).toBe(
      'rdf:type',
    );
  });

  test('given a URI with no matching prefix, returns <full-uri>', () => {
    expect(formatUri('http://unknown.example.org/foo')).toBe(
      '<http://unknown.example.org/foo>',
    );
  });

  test('given a URI where the suffix contains /, returns <full-uri>', () => {
    // The xsd base is http://www.w3.org/2001/XMLSchema#
    // A URI like rdf base + "sub/path" should not be prefixed
    expect(
      formatUri('http://www.w3.org/1999/02/22-rdf-syntax-ns#sub/path'),
    ).toBe('<http://www.w3.org/1999/02/22-rdf-syntax-ns#sub/path>');
  });
});

describe('formatLiteral', () => {
  test('given a plain string without datatype, returns quoted string', () => {
    expect(formatLiteral('hello')).toBe('"hello"');
  });

  test('given an integer with xsd:integer datatype, returns typed literal', () => {
    expect(
      formatLiteral(42, 'http://www.w3.org/2001/XMLSchema#integer'),
    ).toBe('"42"^^xsd:integer');
  });

  test('given a double with xsd:double datatype, returns typed literal', () => {
    expect(
      formatLiteral(3.14, 'http://www.w3.org/2001/XMLSchema#double'),
    ).toBe('"3.14"^^xsd:double');
  });

  test('given a boolean with xsd:boolean datatype, returns typed literal', () => {
    expect(
      formatLiteral(true, 'http://www.w3.org/2001/XMLSchema#boolean'),
    ).toBe('"true"^^xsd:boolean');
  });

  test('given a Date with xsd:dateTime datatype, returns ISO typed literal', () => {
    const result = formatLiteral(
      new Date('2020-01-01T00:00:00.000Z'),
      'http://www.w3.org/2001/XMLSchema#dateTime',
    );
    expect(result).toBe('"2020-01-01T00:00:00.000Z"^^xsd:dateTime');
  });
});

describe('escapeSparqlString', () => {
  test('escapes double quotes', () => {
    expect(escapeSparqlString('say "hello"')).toBe('say \\"hello\\"');
  });

  test('escapes backslashes', () => {
    expect(escapeSparqlString('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  test('escapes newlines', () => {
    expect(escapeSparqlString('line1\nline2')).toBe('line1\\nline2');
  });

  test('escapes tabs', () => {
    expect(escapeSparqlString('tab\there')).toBe('tab\\there');
  });

  test('escapes carriage returns', () => {
    expect(escapeSparqlString('cr\rhere')).toBe('cr\\rhere');
  });

  test('escapes combined special characters', () => {
    expect(escapeSparqlString('a"b\\c\nd')).toBe('a\\"b\\\\c\\nd');
  });

  test('leaves plain strings unchanged', () => {
    expect(escapeSparqlString('hello world')).toBe('hello world');
  });
});

describe('formatLiteral — escaping', () => {
  test('escapes double quotes in literal values', () => {
    expect(formatLiteral('say "hello"')).toBe('"say \\"hello\\""');
  });

  test('escapes backslashes in typed literals', () => {
    expect(formatLiteral('c:\\path')).toBe('"c:\\\\path"');
  });

  test('escapes newlines in plain literals', () => {
    expect(formatLiteral('line1\nline2')).toBe('"line1\\nline2"');
  });
});

describe('collectPrefixes', () => {
  test('given URIs with registered prefixes, returns only used prefix mappings', () => {
    const result = collectPrefixes([
      'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
      'http://www.w3.org/2001/XMLSchema#integer',
      'http://unknown.example.org/something',
    ]);
    expect(result).toEqual({
      rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
      xsd: 'http://www.w3.org/2001/XMLSchema#',
    });
  });

  test('given an empty list, returns empty object', () => {
    expect(collectPrefixes([])).toEqual({});
  });

  test('given URIs with non-prefixable suffixes, excludes them', () => {
    const result = collectPrefixes([
      'http://www.w3.org/1999/02/22-rdf-syntax-ns#sub/path',
    ]);
    expect(result).toEqual({});
  });
});

describe('generateEntityUri', () => {
  test('given a shape URI and explicit dataRoot, generates correct URI format', () => {
    const uri = generateEntityUri('http://example.org/Person', {
      dataRoot: 'http://data.example.org',
    });
    expect(uri).toMatch(/^http:\/\/data\.example\.org\/person_[0-9A-Z]{26}$/);
  });

  test('uses process.env.DATA_ROOT when no explicit dataRoot is given', () => {
    const original = process.env.DATA_ROOT;
    process.env.DATA_ROOT = 'http://env.example.org/data';
    try {
      const uri = generateEntityUri('http://example.org/Person');
      expect(uri).toMatch(
        /^http:\/\/env\.example\.org\/data\/person_[0-9A-Z]{26}$/,
      );
    } finally {
      if (original !== undefined) {
        process.env.DATA_ROOT = original;
      } else {
        delete process.env.DATA_ROOT;
      }
    }
  });

  test('extracts label from hash URI', () => {
    const uri = generateEntityUri('http://example.org/ns#Employee', {
      dataRoot: 'http://data.test',
    });
    expect(uri).toMatch(/^http:\/\/data\.test\/employee_[0-9A-Z]{26}$/);
  });

  test('generates unique URIs on successive calls', () => {
    const opts = {dataRoot: 'http://data.test'};
    const uri1 = generateEntityUri('http://example.org/Person', opts);
    const uri2 = generateEntityUri('http://example.org/Person', opts);
    expect(uri1).not.toBe(uri2);
  });
});
