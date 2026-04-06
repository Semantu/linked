/**
 * Serialization and deserialization helpers for QueryBuilder fields that contain
 * live object references (PropertyShape, ExpressionNode, etc.).
 *
 * These convert between runtime WherePath / SortByPath / RawMinusEntry structures
 * and plain JSON-safe representations that can round-trip through JSON.stringify/parse.
 */

import type {NodeShape} from '../shapes/SHACL.js';
import {getShapeClass} from '../utils/ShapeClass.js';
import {walkPropertyPath} from './PropertyPath.js';
import {ExpressionNode} from '../expressions/ExpressionNode.js';
import {
  WhereMethods,
  type WherePath,
  type WhereEvaluationPath,
  type WhereAndOr,
  type WhereExpressionPath,
  type QueryPropertyPath,
  type QueryStep,
  type PropertyQueryStep,
  type SizeStep,
  type QueryArg,
  type ArgPath,
  type SortByPath,
  type AndOrQueryToken,
} from './SelectQuery.js';
import type {ShapeReferenceValue, NodeReferenceValue} from './QueryFactory.js';
import type {IRExpression} from './IntermediateRepresentation.js';
import type {RawMinusEntry, PropertyPathSegment} from './IRDesugar.js';

// =============================================================================
// JSON types
// =============================================================================

export type QueryStepJSON =
  | {kind: 'property'; label: string; where?: WherePathJSON}
  | {kind: 'size'; count: QueryStepJSON[]; label?: string}
  | {kind: 'shapeRef'; id: string; shapeId: string};

export type WherePathJSON =
  | {kind: 'evaluation'; path: QueryStepJSON[]; method: string; args: QueryArgJSON[]}
  | {kind: 'andOr'; firstPath: WherePathJSON; andOr: {and?: WherePathJSON; or?: WherePathJSON}[]}
  | {kind: 'expression'; ir: IRExpression; refs?: Record<string, string[]>};

export type QueryArgJSON =
  | {kind: 'nodeRef'; id: string}
  | {kind: 'primitive'; value: string | number | boolean}
  | {kind: 'date'; value: string}
  | {kind: 'argPath'; path: QueryStepJSON[]; subject: {id: string; shapeId: string}}
  | {kind: 'where'; where: WherePathJSON};

export type SortByPathJSON = {
  paths: string[];
  direction: 'ASC' | 'DESC';
};

export type RawMinusEntryJSON = {
  shapeId?: string;
  where?: WherePathJSON;
  propertyPaths?: string[][];
};

// =============================================================================
// Serialization
// =============================================================================

export function serializeQueryPropertyPath(path: QueryPropertyPath): QueryStepJSON[] {
  return path.map(serializeQueryStep);
}

function serializeQueryStep(step: QueryStep): QueryStepJSON {
  // PropertyQueryStep — has a .property field that is a PropertyShape
  if ('property' in step && (step as PropertyQueryStep).property) {
    const pqs = step as PropertyQueryStep;
    const json: {kind: 'property'; label: string; where?: WherePathJSON} = {
      kind: 'property',
      label: pqs.property.label,
    };
    if (pqs.where) {
      json.where = serializeWherePath(pqs.where);
    }
    return json;
  }
  // SizeStep — has a .count field
  if ('count' in step) {
    const ss = step as SizeStep;
    const json: {kind: 'size'; count: QueryStepJSON[]; label?: string} = {
      kind: 'size',
      count: serializeQueryPropertyPath(ss.count),
    };
    if (ss.label) json.label = ss.label;
    return json;
  }
  // ShapeReferenceValue — has .id and .shape
  const ref = step as ShapeReferenceValue;
  return {kind: 'shapeRef', id: ref.id, shapeId: ref.shape.id};
}

export function serializeWherePath(where: WherePath): WherePathJSON {
  // WhereExpressionPath
  if ('expressionNode' in where) {
    const expr = (where as WhereExpressionPath).expressionNode;
    const json: {kind: 'expression'; ir: IRExpression; refs?: Record<string, string[]>} = {
      kind: 'expression',
      ir: expr.ir,
    };
    if (expr._refs.size > 0) {
      const refs: Record<string, string[]> = {};
      for (const [k, v] of expr._refs) refs[k] = [...v];
      json.refs = refs;
    }
    return json;
  }
  // WhereAndOr
  if ('firstPath' in where) {
    const andOr = where as WhereAndOr;
    return {
      kind: 'andOr',
      firstPath: serializeWherePath(andOr.firstPath),
      andOr: andOr.andOr.map((token) => {
        const t: {and?: WherePathJSON; or?: WherePathJSON} = {};
        if (token.and) t.and = serializeWherePath(token.and);
        if (token.or) t.or = serializeWherePath(token.or);
        return t;
      }),
    };
  }
  // WhereEvaluationPath
  const ev = where as WhereEvaluationPath;
  return {
    kind: 'evaluation',
    path: serializeQueryPropertyPath(ev.path),
    method: ev.method,
    args: ev.args.map(serializeQueryArg),
  };
}

function serializeQueryArg(arg: QueryArg): QueryArgJSON {
  if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') {
    return {kind: 'primitive', value: arg};
  }
  if (arg instanceof Date) {
    return {kind: 'date', value: arg.toISOString()};
  }
  if (typeof arg === 'object' && arg !== null) {
    // WhereExpressionPath, WhereAndOr, or WhereEvaluationPath (nested WherePath)
    if ('expressionNode' in arg || 'firstPath' in arg || ('path' in arg && 'method' in arg && 'args' in arg)) {
      return {kind: 'where', where: serializeWherePath(arg as WherePath)};
    }
    // ArgPath — has 'subject' and 'path'
    if ('subject' in arg && 'path' in arg) {
      const ap = arg as ArgPath;
      return {
        kind: 'argPath',
        path: serializeQueryPropertyPath(ap.path),
        subject: {id: ap.subject.id, shapeId: ap.subject.shape.id},
      };
    }
    // NodeReferenceValue — has 'id'
    if ('id' in arg) {
      return {kind: 'nodeRef', id: (arg as NodeReferenceValue).id};
    }
  }
  throw new Error(`Cannot serialize query arg: ${JSON.stringify(arg)}`);
}

export function serializeSortByPath(sort: SortByPath): SortByPathJSON {
  return {
    paths: sort.paths.map((p) => p.toString()),
    direction: sort.direction,
  };
}

export function serializeRawMinusEntry(entry: RawMinusEntry): RawMinusEntryJSON {
  const json: RawMinusEntryJSON = {};
  if (entry.shapeId) json.shapeId = entry.shapeId;
  if (entry.where) json.where = serializeWherePath(entry.where);
  if (entry.propertyPaths) {
    json.propertyPaths = entry.propertyPaths.map((pp) =>
      pp.map((seg) => seg.propertyShapeId),
    );
  }
  return json;
}

// =============================================================================
// Deserialization
// =============================================================================

export function deserializeQueryPropertyPath(
  shape: NodeShape,
  steps: QueryStepJSON[],
): QueryPropertyPath {
  const result: QueryStep[] = [];
  let currentShape = shape;

  for (const step of steps) {
    if (step.kind === 'property') {
      const propertyShape = currentShape.getPropertyShape(step.label);
      if (!propertyShape) {
        throw new Error(
          `Property '${step.label}' not found on shape '${currentShape.label || currentShape.id}'`,
        );
      }
      const queryStep: PropertyQueryStep = {property: propertyShape};
      if (step.where) {
        const nestedShape = propertyShape.valueShape
          ? getShapeClass(propertyShape.valueShape)?.shape
          : currentShape;
        queryStep.where = deserializeWherePath(nestedShape || currentShape, step.where);
      }
      result.push(queryStep);

      // Advance shape context for subsequent traversals
      if (propertyShape.valueShape) {
        const cls = getShapeClass(propertyShape.valueShape);
        if (cls?.shape) currentShape = cls.shape;
      }
    } else if (step.kind === 'size') {
      result.push({
        count: deserializeQueryPropertyPath(currentShape, step.count),
        label: step.label,
      } as SizeStep);
    } else {
      // shapeRef
      result.push({id: step.id, shape: {id: step.shapeId}} as ShapeReferenceValue);
    }
  }

  return result;
}

export function deserializeWherePath(shape: NodeShape, json: WherePathJSON): WherePath {
  if (json.kind === 'expression') {
    const refs = new Map<string, readonly string[]>();
    if (json.refs) {
      for (const [k, v] of Object.entries(json.refs)) refs.set(k, v);
    }
    return {expressionNode: new ExpressionNode(json.ir, refs)};
  }
  if (json.kind === 'andOr') {
    return {
      firstPath: deserializeWherePath(shape, json.firstPath),
      andOr: json.andOr.map((token): AndOrQueryToken => {
        const t: AndOrQueryToken = {};
        if (token.and) t.and = deserializeWherePath(shape, token.and);
        if (token.or) t.or = deserializeWherePath(shape, token.or);
        return t;
      }),
    };
  }
  // evaluation
  return {
    path: deserializeQueryPropertyPath(shape, json.path),
    method: json.method as WhereMethods,
    args: json.args.map((a) => deserializeQueryArg(shape, a)),
  };
}

function deserializeQueryArg(shape: NodeShape, json: QueryArgJSON): QueryArg {
  switch (json.kind) {
    case 'primitive':
      return json.value;
    case 'date':
      return new Date(json.value);
    case 'nodeRef':
      return {id: json.id};
    case 'where':
      return deserializeWherePath(shape, json.where);
    case 'argPath':
      return {
        path: deserializeQueryPropertyPath(shape, json.path),
        subject: {id: json.subject.id, shape: {id: json.subject.shapeId}},
      };
  }
}

export function deserializeSortByPath(shape: NodeShape, json: SortByPathJSON): SortByPath {
  return {
    paths: json.paths.map((p) => walkPropertyPath(shape, p)),
    direction: json.direction,
  };
}

export function deserializeRawMinusEntry(
  shape: NodeShape,
  json: RawMinusEntryJSON,
): RawMinusEntry {
  const entry: RawMinusEntry = {};
  if (json.shapeId) entry.shapeId = json.shapeId;
  if (json.where) entry.where = deserializeWherePath(shape, json.where);
  if (json.propertyPaths) {
    entry.propertyPaths = json.propertyPaths.map((pp) =>
      pp.map((id): PropertyPathSegment => ({propertyShapeId: id})),
    );
  }
  return entry;
}
