import {ExpressionNode, toIRExpression} from './ExpressionNode.js';
import type {ExpressionInput} from './ExpressionNode.js';

function wrap(input: ExpressionInput): ExpressionNode {
  return input instanceof ExpressionNode
    ? input
    : new ExpressionNode(toIRExpression(input));
}

export const Expr = {
  // ---------------------------------------------------------------------------
  // Arithmetic
  // ---------------------------------------------------------------------------

  plus(a: ExpressionInput, b: ExpressionInput): ExpressionNode {
    return wrap(a).plus(b);
  },
  minus(a: ExpressionInput, b: ExpressionInput): ExpressionNode {
    return wrap(a).minus(b);
  },
  times(a: ExpressionInput, b: ExpressionInput): ExpressionNode {
    return wrap(a).times(b);
  },
  divide(a: ExpressionInput, b: ExpressionInput): ExpressionNode {
    return wrap(a).divide(b);
  },
  abs(a: ExpressionInput): ExpressionNode {
    return wrap(a).abs();
  },
  round(a: ExpressionInput): ExpressionNode {
    return wrap(a).round();
  },
  ceil(a: ExpressionInput): ExpressionNode {
    return wrap(a).ceil();
  },
  floor(a: ExpressionInput): ExpressionNode {
    return wrap(a).floor();
  },
  power(a: ExpressionInput, b: number): ExpressionNode {
    return wrap(a).power(b);
  },

  // ---------------------------------------------------------------------------
  // Comparison (short names only)
  // ---------------------------------------------------------------------------

  eq(a: ExpressionInput, b: ExpressionInput): ExpressionNode {
    return wrap(a).eq(b);
  },
  neq(a: ExpressionInput, b: ExpressionInput): ExpressionNode {
    return wrap(a).neq(b);
  },
  gt(a: ExpressionInput, b: ExpressionInput): ExpressionNode {
    return wrap(a).gt(b);
  },
  gte(a: ExpressionInput, b: ExpressionInput): ExpressionNode {
    return wrap(a).gte(b);
  },
  lt(a: ExpressionInput, b: ExpressionInput): ExpressionNode {
    return wrap(a).lt(b);
  },
  lte(a: ExpressionInput, b: ExpressionInput): ExpressionNode {
    return wrap(a).lte(b);
  },

  // ---------------------------------------------------------------------------
  // String
  // ---------------------------------------------------------------------------

  concat(...parts: ExpressionInput[]): ExpressionNode {
    if (parts.length < 2) {
      throw new Error('Expr.concat() requires at least 2 arguments');
    }
    const [first, ...rest] = parts;
    return new ExpressionNode({
      kind: 'function_expr',
      name: 'CONCAT',
      args: parts.map(toIRExpression),
    });
  },
  contains(a: ExpressionInput, b: ExpressionInput): ExpressionNode {
    return wrap(a).contains(b);
  },
  startsWith(a: ExpressionInput, b: ExpressionInput): ExpressionNode {
    return wrap(a).startsWith(b);
  },
  endsWith(a: ExpressionInput, b: ExpressionInput): ExpressionNode {
    return wrap(a).endsWith(b);
  },
  substr(
    a: ExpressionInput,
    start: number,
    len?: number,
  ): ExpressionNode {
    return wrap(a).substr(start, len);
  },
  before(a: ExpressionInput, b: ExpressionInput): ExpressionNode {
    return wrap(a).before(b);
  },
  after(a: ExpressionInput, b: ExpressionInput): ExpressionNode {
    return wrap(a).after(b);
  },
  replace(
    a: ExpressionInput,
    pat: string,
    rep: string,
    flags?: string,
  ): ExpressionNode {
    return wrap(a).replace(pat, rep, flags);
  },
  ucase(a: ExpressionInput): ExpressionNode {
    return wrap(a).ucase();
  },
  lcase(a: ExpressionInput): ExpressionNode {
    return wrap(a).lcase();
  },
  strlen(a: ExpressionInput): ExpressionNode {
    return wrap(a).strlen();
  },
  encodeForUri(a: ExpressionInput): ExpressionNode {
    return wrap(a).encodeForUri();
  },
  regex(
    a: ExpressionInput,
    pat: string,
    flags?: string,
  ): ExpressionNode {
    return wrap(a).matches(pat, flags);
  },

  // ---------------------------------------------------------------------------
  // Date/Time
  // ---------------------------------------------------------------------------

  now(): ExpressionNode {
    return new ExpressionNode({kind: 'function_expr', name: 'NOW', args: []});
  },
  year(a: ExpressionInput): ExpressionNode {
    return wrap(a).year();
  },
  month(a: ExpressionInput): ExpressionNode {
    return wrap(a).month();
  },
  day(a: ExpressionInput): ExpressionNode {
    return wrap(a).day();
  },
  hours(a: ExpressionInput): ExpressionNode {
    return wrap(a).hours();
  },
  minutes(a: ExpressionInput): ExpressionNode {
    return wrap(a).minutes();
  },
  seconds(a: ExpressionInput): ExpressionNode {
    return wrap(a).seconds();
  },
  timezone(a: ExpressionInput): ExpressionNode {
    return wrap(a).timezone();
  },
  tz(a: ExpressionInput): ExpressionNode {
    return wrap(a).tz();
  },

  // ---------------------------------------------------------------------------
  // Logical
  // ---------------------------------------------------------------------------

  and(a: ExpressionInput, b: ExpressionInput): ExpressionNode {
    return wrap(a).and(b);
  },
  or(a: ExpressionInput, b: ExpressionInput): ExpressionNode {
    return wrap(a).or(b);
  },
  not(a: ExpressionInput): ExpressionNode {
    return wrap(a).not();
  },

  // ---------------------------------------------------------------------------
  // Null-handling / Conditional
  // ---------------------------------------------------------------------------

  firstDefined(...args: ExpressionInput[]): ExpressionNode {
    if (args.length < 2) {
      throw new Error('Expr.firstDefined() requires at least 2 arguments');
    }
    return new ExpressionNode({
      kind: 'function_expr',
      name: 'COALESCE',
      args: args.map(toIRExpression),
    });
  },
  ifThen(
    cond: ExpressionInput,
    thenVal: ExpressionInput,
    elseVal: ExpressionInput,
  ): ExpressionNode {
    return new ExpressionNode({
      kind: 'function_expr',
      name: 'IF',
      args: [toIRExpression(cond), toIRExpression(thenVal), toIRExpression(elseVal)],
    });
  },
  bound(a: ExpressionInput): ExpressionNode {
    return wrap(a).isDefined();
  },

  // ---------------------------------------------------------------------------
  // RDF introspection
  // ---------------------------------------------------------------------------

  lang(a: ExpressionInput): ExpressionNode {
    return wrap(a).lang();
  },
  datatype(a: ExpressionInput): ExpressionNode {
    return wrap(a).datatype();
  },
  str(a: ExpressionInput): ExpressionNode {
    return wrap(a).str();
  },
  iri(a: ExpressionInput): ExpressionNode {
    return wrap(a).iri();
  },
  isIri(a: ExpressionInput): ExpressionNode {
    return wrap(a).isIri();
  },
  isLiteral(a: ExpressionInput): ExpressionNode {
    return wrap(a).isLiteral();
  },
  isBlank(a: ExpressionInput): ExpressionNode {
    return wrap(a).isBlank();
  },
  isNumeric(a: ExpressionInput): ExpressionNode {
    return wrap(a).isNumeric();
  },

  // ---------------------------------------------------------------------------
  // Hash
  // ---------------------------------------------------------------------------

  md5(a: ExpressionInput): ExpressionNode {
    return wrap(a).md5();
  },
  sha256(a: ExpressionInput): ExpressionNode {
    return wrap(a).sha256();
  },
  sha512(a: ExpressionInput): ExpressionNode {
    return wrap(a).sha512();
  },
} as const;
