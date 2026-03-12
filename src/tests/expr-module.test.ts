import {describe, expect, test} from '@jest/globals';
import {Expr} from '../expressions/Expr';
import {ExpressionNode, toIRExpression} from '../expressions/ExpressionNode';
import type {IRExpression} from '../queries/IntermediateRepresentation';

const a: IRExpression = {kind: 'property_expr', sourceAlias: 'a0', property: 'x'};
const b: IRExpression = {kind: 'property_expr', sourceAlias: 'a0', property: 'y'};

const nodeA = new ExpressionNode(a);
const nodeB = new ExpressionNode(b);

describe('Expr module', () => {
  // -------------------------------------------------------------------------
  // Arithmetic — produces same IR as fluent
  // -------------------------------------------------------------------------

  describe('arithmetic', () => {
    test('plus', () => {
      expect(Expr.plus(nodeA, nodeB).ir).toEqual(nodeA.plus(nodeB).ir);
    });

    test('minus', () => {
      expect(Expr.minus(nodeA, 5).ir).toEqual(nodeA.minus(5).ir);
    });

    test('times', () => {
      expect(Expr.times(nodeA, 12).ir).toEqual(nodeA.times(12).ir);
    });

    test('divide', () => {
      expect(Expr.divide(nodeA, 2).ir).toEqual(nodeA.divide(2).ir);
    });

    test('abs', () => {
      expect(Expr.abs(nodeA).ir).toEqual(nodeA.abs().ir);
    });

    test('round', () => {
      expect(Expr.round(nodeA).ir).toEqual(nodeA.round().ir);
    });

    test('ceil', () => {
      expect(Expr.ceil(nodeA).ir).toEqual(nodeA.ceil().ir);
    });

    test('floor', () => {
      expect(Expr.floor(nodeA).ir).toEqual(nodeA.floor().ir);
    });

    test('power', () => {
      expect(Expr.power(nodeA, 3).ir).toEqual(nodeA.power(3).ir);
    });
  });

  // -------------------------------------------------------------------------
  // Comparison
  // -------------------------------------------------------------------------

  describe('comparison', () => {
    test('eq', () => {
      expect(Expr.eq(nodeA, 30).ir).toEqual(nodeA.eq(30).ir);
    });

    test('neq', () => {
      expect(Expr.neq(nodeA, 0).ir).toEqual(nodeA.neq(0).ir);
    });

    test('gt', () => {
      expect(Expr.gt(nodeA, 18).ir).toEqual(nodeA.gt(18).ir);
    });

    test('gte', () => {
      expect(Expr.gte(nodeA, 18).ir).toEqual(nodeA.gte(18).ir);
    });

    test('lt', () => {
      expect(Expr.lt(nodeA, 65).ir).toEqual(nodeA.lt(65).ir);
    });

    test('lte', () => {
      expect(Expr.lte(nodeA, 65).ir).toEqual(nodeA.lte(65).ir);
    });
  });

  // -------------------------------------------------------------------------
  // String
  // -------------------------------------------------------------------------

  describe('string', () => {
    test('concat produces CONCAT with all args', () => {
      const result = Expr.concat(nodeA, ' ', nodeB);
      expect(result.ir).toEqual({
        kind: 'function_expr',
        name: 'CONCAT',
        args: [a, {kind: 'literal_expr', value: ' '}, b],
      });
    });

    test('concat requires at least 2 args', () => {
      expect(() => (Expr as any).concat(nodeA)).toThrow('at least 2');
    });

    test('contains', () => {
      expect(Expr.contains(nodeA, 'foo').ir).toEqual(nodeA.contains('foo').ir);
    });

    test('startsWith', () => {
      expect(Expr.startsWith(nodeA, 'A').ir).toEqual(nodeA.startsWith('A').ir);
    });

    test('endsWith', () => {
      expect(Expr.endsWith(nodeA, 'z').ir).toEqual(nodeA.endsWith('z').ir);
    });

    test('substr', () => {
      expect(Expr.substr(nodeA, 1, 5).ir).toEqual(nodeA.substr(1, 5).ir);
    });

    test('before', () => {
      expect(Expr.before(nodeA, '@').ir).toEqual(nodeA.before('@').ir);
    });

    test('after', () => {
      expect(Expr.after(nodeA, '@').ir).toEqual(nodeA.after('@').ir);
    });

    test('replace', () => {
      expect(Expr.replace(nodeA, 'old', 'new', 'i').ir).toEqual(
        nodeA.replace('old', 'new', 'i').ir,
      );
    });

    test('ucase', () => {
      expect(Expr.ucase(nodeA).ir).toEqual(nodeA.ucase().ir);
    });

    test('lcase', () => {
      expect(Expr.lcase(nodeA).ir).toEqual(nodeA.lcase().ir);
    });

    test('strlen', () => {
      expect(Expr.strlen(nodeA).ir).toEqual(nodeA.strlen().ir);
    });

    test('encodeForUri', () => {
      expect(Expr.encodeForUri(nodeA).ir).toEqual(nodeA.encodeForUri().ir);
    });

    test('regex', () => {
      expect(Expr.regex(nodeA, '^A', 'i').ir).toEqual(
        nodeA.matches('^A', 'i').ir,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Date/Time
  // -------------------------------------------------------------------------

  describe('date/time', () => {
    test('now produces function_expr with no args', () => {
      expect(Expr.now().ir).toEqual({
        kind: 'function_expr',
        name: 'NOW',
        args: [],
      });
    });

    test.each([
      ['year', 'YEAR'],
      ['month', 'MONTH'],
      ['day', 'DAY'],
      ['hours', 'HOURS'],
      ['minutes', 'MINUTES'],
      ['seconds', 'SECONDS'],
      ['timezone', 'TIMEZONE'],
      ['tz', 'TZ'],
    ] as [string, string][])('%s', (method, sparqlName) => {
      expect((Expr as any)[method](nodeA).ir).toEqual(
        (nodeA as any)[method]().ir,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Logical
  // -------------------------------------------------------------------------

  describe('logical', () => {
    test('and', () => {
      expect(Expr.and(nodeA, nodeB).ir).toEqual(nodeA.and(nodeB).ir);
    });

    test('or', () => {
      expect(Expr.or(nodeA, nodeB).ir).toEqual(nodeA.or(nodeB).ir);
    });

    test('not', () => {
      expect(Expr.not(nodeA).ir).toEqual(nodeA.not().ir);
    });
  });

  // -------------------------------------------------------------------------
  // Null-handling / Conditional
  // -------------------------------------------------------------------------

  describe('null-handling / conditional', () => {
    test('firstDefined produces COALESCE', () => {
      const result = Expr.firstDefined(nodeA, nodeB, 0);
      expect(result.ir).toEqual({
        kind: 'function_expr',
        name: 'COALESCE',
        args: [a, b, {kind: 'literal_expr', value: 0}],
      });
    });

    test('firstDefined requires at least 2 args', () => {
      expect(() => (Expr as any).firstDefined(nodeA)).toThrow('at least 2');
    });

    test('ifThen produces IF', () => {
      const cond = nodeA.gt(0);
      const result = Expr.ifThen(cond, 'yes', 'no');
      expect(result.ir).toEqual({
        kind: 'function_expr',
        name: 'IF',
        args: [cond.ir, {kind: 'literal_expr', value: 'yes'}, {kind: 'literal_expr', value: 'no'}],
      });
    });

    test('bound', () => {
      expect(Expr.bound(nodeA).ir).toEqual(nodeA.isDefined().ir);
    });
  });

  // -------------------------------------------------------------------------
  // RDF introspection / type / hash
  // -------------------------------------------------------------------------

  describe('rdf/type/hash', () => {
    test.each([
      ['lang', 'lang'],
      ['datatype', 'datatype'],
      ['str', 'str'],
      ['iri', 'iri'],
      ['isIri', 'isIri'],
      ['isLiteral', 'isLiteral'],
      ['isBlank', 'isBlank'],
      ['isNumeric', 'isNumeric'],
      ['md5', 'md5'],
      ['sha256', 'sha256'],
      ['sha512', 'sha512'],
    ] as [string, string][])('Expr.%s matches fluent', (exprMethod, fluentMethod) => {
      expect((Expr as any)[exprMethod](nodeA).ir).toEqual(
        (nodeA as any)[fluentMethod]().ir,
      );
    });
  });
});
