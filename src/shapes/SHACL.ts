/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import {NodeReferenceValue} from '../utils/NodeReference.js';
import {Shape, ShapeConstructor} from './Shape.js';
import {shacl} from '../ontologies/shacl.js';
import {URI} from '../utils/URI.js';
import {toNodeReference, type NodeReferenceInput} from '../utils/NodeReference.js';
import {getShapeClass} from '../utils/ShapeClass.js';
import type {PathExpr} from '../paths/PropertyPathExpr.js';
import {normalizePropertyPath, type PropertyPathDecoratorInput} from '../paths/normalizePropertyPath.js';

export const LINCD_DATA_ROOT: string = 'https://data.lincd.org/';

type NodeKindConfig = NodeReferenceValue | NodeReferenceValue[];

export type PropertyPathInput = PropertyPathDecoratorInput;
export type PropertyPathInputList = PropertyPathDecoratorInput;

/** Result object returned by PropertyShape.getResult() and NodeShape.properties. */
export interface PropertyShapeResult {
  id: string;
  label: string;
  path: PathExpr;
  nodeKind?: NodeReferenceValue;
  datatype?: NodeReferenceValue;
  minCount?: number;
  maxCount?: number;
  name?: string;
  description?: string;
  order?: number;
  group?: string;
  class?: NodeReferenceValue;
  in?: (NodeReferenceValue | string | number | boolean)[];
  equals?: NodeReferenceValue;
  disjoint?: NodeReferenceValue;
  lessThan?: NodeReferenceValue;
  lessThanOrEquals?: NodeReferenceValue;
  hasValue?: NodeReferenceValue | string | number | boolean;
  defaultValue?: unknown;
  sortBy?: PathExpr;
  valueShape?: NodeReferenceValue;
}

const toPlainNodeRef = (
  value: NodeReferenceValue | {id: string} | string,
): NodeReferenceValue => {
  return toNodeReference(value as NodeReferenceInput);
};

const normalizePathInput = (
  value: PropertyPathDecoratorInput,
): PathExpr => {
  return normalizePropertyPath(value);
};

const normalizeNodeKind = (
  nodeKind?: NodeKindConfig,
  defaultNodeKind?: NodeReferenceValue,
): NodeReferenceValue | undefined => {
  if (!nodeKind) {
    return defaultNodeKind;
  }
  if (Array.isArray(nodeKind)) {
    const ids = nodeKind.map((entry) => entry?.id);
    const includesBlank = ids.includes(shacl.BlankNode.id);
    const includesNamed = ids.includes(shacl.IRI.id);
    const includesLiteral = ids.includes(shacl.Literal.id);
    if (includesBlank && includesNamed) {
      return shacl.BlankNodeOrIRI;
    }
    if (includesLiteral && includesNamed) {
      return shacl.IRIOrLiteral;
    }
    if (includesLiteral && includesBlank) {
      return shacl.BlankNodeOrLiteral;
    }
    return nodeKind[0];
  }
  return nodeKind;
};

export interface NodeShapeConfig {
  /**
   * Set to true to close the shape. This means any target node of this shape
   * that has properties outside the defined properties of this shape is invalid.
   */
  closed?: boolean;
  /**
   * Optional list of properties that are also permitted in addition to those explicitly listed by this shape.
   */
  ignoredProperties?: NodeReferenceValue[];
}

export interface LiteralPropertyShapeConfig extends PropertyShapeConfig {
  nodeKind?: NodeReferenceValue;
  /**
   * Values of the configured property must be less than the values of this 'lessThan' property.
   * Value is always a property IRI (pair constraint).
   */
  lessThan?: NodeReferenceValue;
  /**
   * Values of the configured property must be less than or equal the values of this 'lessThanOrEquals' property.
   * Value is always a property IRI (pair constraint).
   */
  lessThanOrEquals?: NodeReferenceValue;
  /**
   * All values of this property must be higher than this number
   */
  minExclusive?: number | string;
  /**
   * All values of this property must be higher than or equal this number
   */
  minInclusive?: number;
  /**
   * All values of this property must be lower than this number
   */
  maxExclusive?: number;
  /**
   * All values of this property must be lower than or equal this number
   */
  maxInclusive?: number;
  /**
   * All literal values of this property must at least be this long
   */
  minLength?: number;
  /**
   * All literal values of this property must at most be this long
   */
  maxLength?: number;
  /**
   * All literal values of this property must match this regular expression
   */
  pattern?: RegExp;
  /**
   * All literal values of this property must have one of these languages as their language tag
   */
  languageIn?: string[];
  /**
   * No pair of values may use the same language tag.
   */
  uniqueLang?: boolean;
  /**
   * Each literal value of this property must use this datatype
   */
  datatype?: NodeReferenceValue;
  /**
   * Each value of the property must occur in this set.
   * Use {id: '...'} for IRI nodes, or plain strings/numbers/booleans for literal values.
   */
  in?: (NodeReferenceValue | string | number | boolean)[];
}

export interface ObjectPropertyShapeConfig extends PropertyShapeConfig {
  nodeKind?: NodeReferenceValue;
  /**
   * Each value of this property must have this class as its rdf:type
   */
  class?: NodeReferenceValue;
  /**
   * The shape that values of this property path need to confirm to.
   * You need to provide a class that extends Shape.
   */
  shape?: typeof Shape | [string, string];
}

export interface PropertyShapeConfig {
  /**
   * The property path of this property shape.
   */
  path: PropertyPathInputList;
  /**
   * Indicates that this property must exist.
   * Shorthand for minCount=1
   */
  required?: boolean;
  /**
   * Each value must be of this node type.
   */
  nodeKind?: NodeKindConfig;
  /**
   * Minimum number of values required
   */
  minCount?: number;
  /**
   * Maximum number of values allowed
   */
  maxCount?: number;
  /**
   * Values of the configured property must equal the values of this 'equals' property.
   * Value is always a property IRI (pair constraint).
   */
  equals?: NodeReferenceValue;
  /**
   * Values of the configured property must differ from the values of this 'disjoint' property.
   * Value is always a property IRI (pair constraint).
   */
  disjoint?: NodeReferenceValue;
  /**
   * At least one value of this property must equal the given value.
   * Use {id: '...'} for IRI nodes, or a plain string for literal values.
   */
  hasValue?: NodeReferenceValue | string | number | boolean;
  name?: string;
  description?: string;
  order?: number;
  group?: string;
  /**
   * should correlate to the given datatype or class
   */
  defaultValue?: unknown;
  /**
   * Each value of the property must occur in this set.
   * Use {id: '...'} for IRI nodes, or plain strings for literal values.
   *
   * @example
   * in: ['ACTIVE', 'PENDING', 'CLOSED']
   * in: [{id: 'http://example.org/StatusA'}, {id: 'http://example.org/StatusB'}]
   */
  in?: (NodeReferenceValue | string | number | boolean)[];
  /**
   * Values of the configured property path are sorted by the values of this property path.
   */
  sortBy?: PropertyPathInputList;
}

const EXPLICIT_NODE_KIND_SYMBOL = Symbol('explicitNodeKind');
const EXPLICIT_MIN_COUNT_SYMBOL = Symbol('explicitMinCount');
const EXPLICIT_MAX_COUNT_SYMBOL = Symbol('explicitMaxCount');

/** Internal symbol-keyed flags on PropertyShape to track which fields were explicitly configured. */
interface ExplicitFlags {
  [EXPLICIT_NODE_KIND_SYMBOL]?: boolean;
  [EXPLICIT_MIN_COUNT_SYMBOL]?: boolean;
  [EXPLICIT_MAX_COUNT_SYMBOL]?: boolean;
}

export interface ParameterConfig {
  optional?: number;
}

export class NodeShape extends Shape {
  static targetClass = shacl.NodeShape;
  private _label?: string;
  description?: string;
  targetClass?: NodeReferenceValue;
  extends?: NodeReferenceValue;
  private propertyShapes: PropertyShape[] = [];

  constructor(node?: string | NodeReferenceValue) {
    super(node);
    if (this.id) {
      this.nodeRef = {id: this.id};
    }
  }

  nodeRef?: NodeReferenceValue;

  get label(): string {
    return this._label;
  }

  set label(value: string) {
    this._label = value;
  }

  get properties(): PropertyShapeResult[] {
    return this.propertyShapes.map((propertyShape) => propertyShape.getResult());
  }

  addPropertyShape(propertyShape: PropertyShape) {
    propertyShape.parentNodeShape = this;
    this.propertyShapes.push(propertyShape);
  }

  getPropertyShapes(includeSuperClasses: boolean = false): PropertyShape[] {
    if (!includeSuperClasses) {
      return [...this.propertyShapes];
    }
    const res: PropertyShape[] = [];
    let shapeClass: ShapeConstructor | undefined = getShapeClass(this.id);
    if (!shapeClass) {
      return [...this.propertyShapes];
    }
    while (shapeClass?.shape) {
      res.push(...shapeClass.shape.propertyShapes);
      // Stop at Shape base class. Cast needed: ShapeConstructor (concrete new) vs
      // typeof Shape (abstract new) are structurally incompatible for ===.
      if (shapeClass === (Shape as unknown)) {
        break;
      }
      shapeClass = Object.getPrototypeOf(shapeClass) as ShapeConstructor | undefined;
    }
    return res;
  }

  getUniquePropertyShapes(): PropertyShape[] {
    const uniquePropertyShapes: PropertyShape[] = [];
    const seen = new Set<string>();
    this.getPropertyShapes(true).forEach((propertyShape) => {
      if (!seen.has(propertyShape.label)) {
        seen.add(propertyShape.label);
        uniquePropertyShapes.push(propertyShape);
      }
    });
    return uniquePropertyShapes;
  }

  getPropertyShape(
    label: string,
    checkSubShapes: boolean = true,
  ): PropertyShape {
    let shapeClass: ShapeConstructor | undefined = getShapeClass(this.id);
    let res: PropertyShape;
    if (!shapeClass) {
      return this.propertyShapes.find((shape) => shape.label === label);
    }
    while (!res && shapeClass?.shape) {
      res = shapeClass.shape.propertyShapes.find(
        (shape) => shape.label === label,
      );
      if (checkSubShapes) {
        if (shapeClass === (Shape as unknown)) {
          break;
        }
        shapeClass = Object.getPrototypeOf(shapeClass) as ShapeConstructor | undefined;
      } else {
        break;
      }
    }
    return res;
  }

  validateNode(_node?: unknown): boolean {
    return true;
  }

  equals(other: NodeShape): boolean {
    return !!other && this.id === other.id;
  }
}

export class PropertyShape extends Shape {
  static targetClass = shacl.PropertyShape;
  private _label?: string;
  path: PathExpr;
  nodeKind?: NodeReferenceValue;
  datatype?: NodeReferenceValue;
  minCount?: number;
  maxCount?: number;
  name?: string;
  description?: string;
  order?: number;
  group?: string;
  class?: NodeReferenceValue;
  in?: (NodeReferenceValue | string | number | boolean)[];
  equalsConstraint?: NodeReferenceValue;
  disjoint?: NodeReferenceValue;
  lessThan?: NodeReferenceValue;
  lessThanOrEquals?: NodeReferenceValue;
  hasValueConstraint?: NodeReferenceValue | string | number | boolean;
  defaultValue?: unknown;
  sortBy?: PathExpr;
  valueShape?: NodeReferenceValue;
  parentNodeShape?: NodeShape;

  constructor() {
    super();
  }

  get label(): string {
    return this._label;
  }

  set label(value: string) {
    this._label = value;
  }

  getResult(): PropertyShapeResult {
    const result: Record<string, unknown> & {id: string; label: string; path: PathExpr} = {
      id: this.id,
      label: this.label,
      path: this.path,
    };
    if (this.nodeKind) {
      result.nodeKind = this.nodeKind;
    }
    if (this.datatype) {
      result.datatype = this.datatype;
    }
    if (typeof this.minCount === 'number') {
      result.minCount = this.minCount;
    }
    if (typeof this.maxCount === 'number') {
      result.maxCount = this.maxCount;
    }
    if (this.name) {
      result.name = this.name;
    }
    if (this.description) {
      result.description = this.description;
    }
    if (typeof this.order === 'number') {
      result.order = this.order;
    }
    if (this.group) {
      result.group = this.group;
    }
    if (this.class) {
      result.class = this.class;
    }
    if (this.in) {
      result.in = this.in;
    }
    if (this.equalsConstraint) {
      result.equals = this.equalsConstraint;
    }
    if (this.disjoint) {
      result.disjoint = this.disjoint;
    }
    if (this.lessThan) {
      result.lessThan = this.lessThan;
    }
    if (this.lessThanOrEquals) {
      result.lessThanOrEquals = this.lessThanOrEquals;
    }
    if (this.hasValueConstraint !== undefined) {
      result.hasValue = this.hasValueConstraint;
    }
    if (this.defaultValue !== undefined) {
      result.defaultValue = this.defaultValue;
    }
    if (this.sortBy) {
      result.sortBy = this.sortBy;
    }
    if (this.valueShape) {
      result.valueShape = this.valueShape;
    }
    return result as PropertyShapeResult;
  }

  clone(): this {
    const constructor = this.constructor as new () => this;
    const clone = new constructor();
    Object.assign(clone, this);
    return clone;
  }
}

const connectValueShape = <
  Config extends LiteralPropertyShapeConfig | ObjectPropertyShapeConfig,
>(
  config: Config,
  propertyKey: string,
  property: PropertyShape,
) => {
  if ((config as ObjectPropertyShapeConfig).shape) {
    const shapeConfig = (config as ObjectPropertyShapeConfig).shape;

    if (Array.isArray(shapeConfig)) {
      const [packageName, shapeName] = shapeConfig;
      const nodeShapeUri = getNodeShapeUri(packageName, shapeName);
      property.valueShape = {id: nodeShapeUri};
    } else {
      const shapeClass = shapeConfig as typeof Shape;
      if (shapeClass.shape) {
        property.valueShape = {id: shapeClass.shape.id};
      } else {
        onShapeSetup(
          shapeConfig,
          (nodeShape: NodeShape) => {
            property.valueShape = {id: nodeShape.id};
          },
          propertyKey,
        );
      }
    }
  }
};

export function registerPropertyShape(
  shape: NodeShape,
  propertyShape: PropertyShape,
) {
  const inherited = shape.getPropertyShape(propertyShape.label, true);
  const existing = shape.getPropertyShape(propertyShape.label, false);
  if (!existing && inherited) {
    if (!(propertyShape as unknown as ExplicitFlags)[EXPLICIT_MIN_COUNT_SYMBOL]) {
      propertyShape.minCount = inherited.minCount;
    }
    if (!(propertyShape as unknown as ExplicitFlags)[EXPLICIT_MAX_COUNT_SYMBOL]) {
      propertyShape.maxCount = inherited.maxCount;
    }
    if (!(propertyShape as unknown as ExplicitFlags)[EXPLICIT_NODE_KIND_SYMBOL]) {
      propertyShape.nodeKind = inherited.nodeKind;
    }
    validateOverrideTightening(shape, inherited, propertyShape);
  }
  if (existing) {
    Object.assign(existing, propertyShape);
    return existing;
  }
  propertyShape.id = `${shape.id}/${propertyShape.label}`;
  shape.addPropertyShape(propertyShape);
  return propertyShape;
}

const ATOMIC_NODE_KINDS = [
  shacl.BlankNode.id,
  shacl.IRI.id,
  shacl.Literal.id,
];

const nodeKindToAtomics = (nodeKind?: NodeReferenceValue): Set<string> => {
  if (!nodeKind?.id) {
    return new Set();
  }
  switch (nodeKind.id) {
    case shacl.BlankNode.id:
    case shacl.IRI.id:
    case shacl.Literal.id:
      return new Set([nodeKind.id]);
    case shacl.BlankNodeOrIRI.id:
      return new Set([shacl.BlankNode.id, shacl.IRI.id]);
    case shacl.IRIOrLiteral.id:
      return new Set([shacl.IRI.id, shacl.Literal.id]);
    case shacl.BlankNodeOrLiteral.id:
      return new Set([shacl.BlankNode.id, shacl.Literal.id]);
    default:
      return new Set(ATOMIC_NODE_KINDS);
  }
};

const throwOverrideError = (
  shape: NodeShape,
  propertyShape: PropertyShape,
  message: string,
) => {
  throw new Error(
    `Invalid override for ${shape.label}.${propertyShape.label}: ${message}`,
  );
};

const validateOverrideTightening = (
  shape: NodeShape,
  base: PropertyShape,
  override: PropertyShape,
) => {
  if (
    typeof base.minCount === 'number' &&
    typeof override.minCount === 'number' &&
    override.minCount < base.minCount
  ) {
    throwOverrideError(
      shape,
      override,
      `minCount cannot be lowered (${base.minCount} -> ${override.minCount}).`,
    );
  }

  if (
    typeof base.maxCount === 'number' &&
    typeof override.maxCount === 'number' &&
    override.maxCount > base.maxCount
  ) {
    throwOverrideError(
      shape,
      override,
      `maxCount cannot be increased (${base.maxCount} -> ${override.maxCount}).`,
    );
  }

  if (base.nodeKind && override.nodeKind) {
    const baseKinds = nodeKindToAtomics(base.nodeKind);
    const overrideKinds = nodeKindToAtomics(override.nodeKind);
    const widensNodeKind = [...overrideKinds].some((kind) => !baseKinds.has(kind));
    if (widensNodeKind) {
      throwOverrideError(
        shape,
        override,
        `nodeKind cannot be widened (${base.nodeKind.id} -> ${override.nodeKind.id}).`,
      );
    }
  }
};

export function createPropertyShape<
  Config extends LiteralPropertyShapeConfig | ObjectPropertyShapeConfig,
>(
  config: Config,
  propertyKey: string,
  defaultNodeKind: NodeReferenceValue = null,
  shapeClass: typeof Shape | [string, string] = null,
) {
  const propertyShape = new PropertyShape();
  propertyShape.path = normalizePathInput(config.path);
  propertyShape.label = propertyKey;

  if (config.name) {
    propertyShape.name = config.name;
  }
  if (config.description) {
    propertyShape.description = config.description;
  }

  if (config.required) {
    propertyShape.minCount = 1;
  } else if (config.minCount !== undefined) {
    propertyShape.minCount = config.minCount;
  }
  (propertyShape as unknown as ExplicitFlags)[EXPLICIT_MIN_COUNT_SYMBOL] =
    config.required === true || config.minCount !== undefined;

  if (config.maxCount !== undefined) {
    propertyShape.maxCount = config.maxCount;
  }
  (propertyShape as unknown as ExplicitFlags)[EXPLICIT_MAX_COUNT_SYMBOL] =
    config.maxCount !== undefined;
  if ((config as LiteralPropertyShapeConfig).datatype) {
    propertyShape.datatype = toPlainNodeRef(
      (config as LiteralPropertyShapeConfig).datatype,
    );
  }

  if ((config as ObjectPropertyShapeConfig).class) {
    propertyShape.class = toPlainNodeRef(
      (config as ObjectPropertyShapeConfig).class,
    );
  }

  if (config.equals) {
    propertyShape.equalsConstraint = toPlainNodeRef(config.equals);
  }
  if (config.disjoint) {
    propertyShape.disjoint = toPlainNodeRef(config.disjoint);
  }
  if ((config as LiteralPropertyShapeConfig).lessThan) {
    propertyShape.lessThan = toPlainNodeRef((config as LiteralPropertyShapeConfig).lessThan);
  }
  if ((config as LiteralPropertyShapeConfig).lessThanOrEquals) {
    propertyShape.lessThanOrEquals = toPlainNodeRef((config as LiteralPropertyShapeConfig).lessThanOrEquals);
  }
  if (config.hasValue !== undefined) {
    const v = config.hasValue;
    propertyShape.hasValueConstraint = typeof v === 'object' && v !== null ? toPlainNodeRef(v) : v;
  }
  if (config.defaultValue !== undefined) {
    propertyShape.defaultValue = config.defaultValue;
  }
  if (config.in) {
    propertyShape.in = config.in.map((entry) =>
      typeof entry === 'object' && entry !== null ? toPlainNodeRef(entry) : entry,
    );
  }
  if (config.sortBy) {
    propertyShape.sortBy = normalizePathInput(config.sortBy);
  }

  propertyShape.nodeKind = normalizeNodeKind(config.nodeKind, defaultNodeKind);
  (propertyShape as unknown as ExplicitFlags)[EXPLICIT_NODE_KIND_SYMBOL] =
    config.nodeKind !== undefined;

  if (shapeClass) {
    onShapeSetup(shapeClass, (shape: NodeShape) => {
      connectValueShape(config, propertyKey, propertyShape);
      registerPropertyShape(shape, propertyShape);
    });
  }

  return propertyShape;
}

export function onShapeSetup(
  shapeClass: typeof Shape | [string, string],
  callback: (shape: NodeShape) => void,
  propertyName?: string,
  waitForSuperShapes?: boolean,
) {
  const cb = waitForSuperShapes
    ? (shape: NodeShape) => {
        const superClass = Object.getPrototypeOf(shapeClass) as typeof Shape;
        if (superClass.name === 'Shape') {
          callback(shape);
          return;
        }
        if (superClass.name === '') {
          console.error(
            `Shape ${shape.label} does not extend base class lincd/shapes/Shape. Make sure it extends Shape.`,
          );
          return;
        }
        onShapeSetup(
          superClass,
          () => {
            callback(shape);
          },
          propertyName,
          waitForSuperShapes,
        );
      }
    : callback;

  const safeCallback = (
    targetShapeClass: typeof Shape,
    innerCallback: (shape: NodeShape) => void,
  ) => {
    if (targetShapeClass.hasOwnProperty('shape')) {
      innerCallback((targetShapeClass as typeof Shape).shape);
    } else {
      if (!targetShapeClass['shapeCallbacks']) {
        targetShapeClass['shapeCallbacks'] = [];
      }
      targetShapeClass['shapeCallbacks'].push(innerCallback);
    }
  };

  if (Array.isArray(shapeClass)) {
    const [packageName, shapeName] = shapeClass;
    const nodeShapeId = getNodeShapeUri(packageName, shapeName);
    if (typeof document !== 'undefined') {
      window.addEventListener('load', () => {
        const resolved = getShapeClass(nodeShapeId);
        if (!resolved) {
          console.warn(
            `Could not find value shape (${packageName}/${shapeName}) for accessor get ${propertyName}(). Likely because it is not bundled.`,
          );
          return;
        }
        safeCallback(resolved as unknown as typeof Shape, cb);
      });
    } else {
      addNodeShapeCallback(nodeShapeId, cb);
    }
  } else {
    safeCallback(shapeClass, cb);
  }
}

const _linkedProperty = <
  Config extends ObjectPropertyShapeConfig | LiteralPropertyShapeConfig,
>(
  config: Config,
  defaultNodeKind: NodeReferenceValue = null,
) => {
  return function (
    target: any,
    propertyKey: string,
    _descriptor: PropertyDescriptor,
  ) {
    createPropertyShape(config, propertyKey, defaultNodeKind, target.constructor);
  };
};

export const literalProperty = (config: LiteralPropertyShapeConfig) => {
  return _linkedProperty<LiteralPropertyShapeConfig>(config, shacl.Literal);
};

export const objectProperty = (config: ObjectPropertyShapeConfig) => {
  return _linkedProperty<ObjectPropertyShapeConfig>(config, shacl.IRI);
};

export const linkedProperty = (
  config: ObjectPropertyShapeConfig | LiteralPropertyShapeConfig,
) => {
  return _linkedProperty(config);
};

export function disallowProperty(
  target: any,
  propertyKey: string,
  _descriptor: PropertyDescriptor,
) {
  onShapeSetup(
    target.constructor,
    (shape: NodeShape) => {
      const superClass = Object.getPrototypeOf(target.constructor) as typeof Shape;
      const superNodeShape = superClass.shape;
      const superPropertyShape = superNodeShape.getPropertyShape(
        propertyKey,
        true,
      );
      if (!superPropertyShape) {
        console.warn(
          `Property ${propertyKey} not found in super class ${superClass.name} or any of its super classes. Does it have a property decorator? Cannot disallow property ${target.constructor.name}.${propertyKey}`,
        );
        return;
      }
      const clonedPropertyShape = superPropertyShape.clone();
      clonedPropertyShape.maxCount = 0;
      registerPropertyShape(shape, clonedPropertyShape);
    },
    '',
    true,
  );
}

export function getNodeShapeUri(packageName: string, shapeName: string): string {
  return `${LINCD_DATA_ROOT}module/${URI.sanitize(packageName)}/shape/${URI.sanitize(
    shapeName,
  )}`;
}

const nodeShapeCallbacks = new Map<string, ((shape: NodeShape) => void)[]>();
export function getAndClearCallbacks(
  nodeShapeId: string,
): ((shape: NodeShape) => void)[] {
  const callbacks = nodeShapeCallbacks.get(nodeShapeId);
  nodeShapeCallbacks.delete(nodeShapeId);
  return callbacks;
}
export const addNodeShapeCallback = (
  nodeShapeId: string,
  callback: (shape: NodeShape) => void,
) => {
  if (!nodeShapeCallbacks.has(nodeShapeId)) {
    nodeShapeCallbacks.set(nodeShapeId, []);
  }
  nodeShapeCallbacks.get(nodeShapeId).push(callback);
};
