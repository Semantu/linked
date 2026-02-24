import {NodeReferenceValue} from './QueryFactory.js';

export type IRDirection = 'ASC' | 'DESC';
export type IRAlias = string;

export type IRValue = string | number | boolean | null;

export type IRQuery = IRSelectQuery | IRCreateMutation | IRUpdateMutation | IRDeleteMutation;

export type IRSelectQuery = {
  kind: 'select';
  root: IRShapeScanPattern;
  patterns: IRGraphPattern[];
  projection: IRProjectionItem[];
  where?: IRExpression;
  orderBy?: IROrderByItem[];
  limit?: number;
  offset?: number;
  subjectId?: string;
  singleResult?: boolean;
  resultMap?: IRResultMapEntry[];
};

export type IRProjectionItem = {
  alias: IRAlias;
  expression: IRExpression;
};

export type IROrderByItem = {
  expression: IRExpression;
  direction: IRDirection;
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
  shape: string;
  alias: IRAlias;
};

export type IRTraversePattern = {
  kind: 'traverse';
  from: IRAlias;
  to: IRAlias;
  property: string;
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
  kind: 'exists';
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
  property: string;
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
  filter?: IRExpression;
};

export type IRCreateMutation = {
  kind: 'create';
  shape: string;
  data: IRNodeData;
};

export type IRUpdateMutation = {
  kind: 'update';
  shape: string;
  id: string;
  data: IRNodeData;
};

export type IRDeleteMutation = {
  kind: 'delete';
  shape: string;
  ids: NodeReferenceValue[];
};

export type IRNodeData = {
  shape: string;
  fields: IRFieldUpdate[];
  id?: string;
};

export type IRFieldUpdate = {
  property: string;
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
  | IRNodeData
  | IRSetModificationValue
  | IRFieldValue[]
  | undefined;
