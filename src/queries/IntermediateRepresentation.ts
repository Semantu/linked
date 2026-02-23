import {NodeReferenceValue} from './QueryFactory.js';

export type IRDirection = 'ASC' | 'DESC';
export type IRAlias = string;

export type IRShapeRef = {
  shapeId: string;
};

export type IRPropertyRef = {
  propertyShapeId: string;
};

export type IRValue = string | number | boolean | null;

export type IRQuery = IRSelectQuery | IRCreateMutation | IRUpdateMutation | IRDeleteMutation;

export type IRSelectQuery = {
  kind: 'select_query';
  root: IRShapeScanPattern;
  projection: IRProjectionItem[];
  where?: IRExpression;
  orderBy?: IROrderByItem[];
  limit?: number;
  offset?: number;
  resultMap?: IRResultMap;
};

export type IRProjectionItem = {
  kind: 'projection_item';
  alias: IRAlias;
  expression: IRExpression;
};

export type IROrderByItem = {
  kind: 'order_by_item';
  expression: IRExpression;
  direction: IRDirection;
};

export type IRResultMap = {
  kind: 'result_map';
  entries: IRResultMapEntry[];
};

export type IRResultMapEntry = {
  key: string;
  alias: IRAlias;
};

export type IRGraphPattern =
  | IRShapeScanPattern
  | IRTraversePattern
  | IRJoinPattern
  | IROptionalPattern
  | IRUnionPattern
  | IRExistsPattern;

export type IRShapeScanPattern = {
  kind: 'shape_scan';
  shape: IRShapeRef;
  alias: IRAlias;
};

export type IRTraversePattern = {
  kind: 'traverse';
  from: IRAlias;
  to: IRAlias;
  property: IRPropertyRef;
};

export type IRJoinPattern = {
  kind: 'join';
  patterns: IRGraphPattern[];
};

export type IROptionalPattern = {
  kind: 'optional';
  pattern: IRGraphPattern;
};

export type IRUnionPattern = {
  kind: 'union';
  branches: IRGraphPattern[];
};

export type IRExistsPattern = {
  kind: 'exists_pattern';
  pattern: IRGraphPattern;
};

export type IRExpression =
  | IRLiteralExpression
  | IRAliasExpression
  | IRPropertyExpression
  | IRBinaryExpression
  | IRLogicalExpression
  | IRNotExpression
  | IRFunctionExpression
  | IRAggregateExpression
  | IRExistsExpression;

export type IRLiteralExpression = {
  kind: 'literal_expr';
  value: IRValue;
};

export type IRAliasExpression = {
  kind: 'alias_expr';
  alias: IRAlias;
};

export type IRPropertyExpression = {
  kind: 'property_expr';
  sourceAlias: IRAlias;
  property: IRPropertyRef;
};

export type IRBinaryOperator =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<=';

export type IRBinaryExpression = {
  kind: 'binary_expr';
  operator: IRBinaryOperator;
  left: IRExpression;
  right: IRExpression;
};

export type IRLogicalOperator = 'and' | 'or';

export type IRLogicalExpression = {
  kind: 'logical_expr';
  operator: IRLogicalOperator;
  expressions: IRExpression[];
};

export type IRNotExpression = {
  kind: 'not_expr';
  expression: IRExpression;
};

export type IRFunctionExpression = {
  kind: 'function_expr';
  name: string;
  args: IRExpression[];
};

export type IRAggregateExpression = {
  kind: 'aggregate_expr';
  name: 'count' | 'sum' | 'avg' | 'min' | 'max';
  args: IRExpression[];
};

export type IRExistsExpression = {
  kind: 'exists_expr';
  pattern: IRGraphPattern;
};

export type IRCreateMutation = {
  kind: 'create_mutation';
  shape: IRShapeRef;
  description: IRNodeDescription;
};

export type IRUpdateMutation = {
  kind: 'update_mutation';
  shape: IRShapeRef;
  id: string;
  updates: IRNodeDescription;
};

export type IRDeleteMutation = {
  kind: 'delete_mutation';
  shape: IRShapeRef;
  ids: NodeReferenceValue[];
};

export type IRNodeDescription = {
  shape: IRShapeRef;
  fields: IRNodeFieldUpdate[];
  id?: string;
};

export type IRNodeFieldUpdate = {
  property: IRPropertyRef;
  value: IRFieldValue;
};

export type IRSetModificationValue = {
  add?: IRFieldValue[];
  remove?: NodeReferenceValue[];
};

export type IRFieldValue =
  | IRValue
  | Date
  | NodeReferenceValue
  | IRNodeDescription
  | IRSetModificationValue
  | IRFieldValue[]
  | undefined;
