import {NodeShape} from '../shapes/SHACL.js';
import {
  NodeDescriptionValue,
  NodeReferenceValue,
  PropUpdateValue,
  SetModificationValue,
  SinglePropertyUpdateValue,
  isSetModificationValue,
} from './QueryFactory.js';
import {
  IRCreateMutation,
  IRDeleteMutation,
  IRFieldValue,
  IRNodeDescription,
  IRNodeFieldUpdate,
  IRSetModificationValue,
  IRUpdateMutation,
} from './IntermediateRepresentation.js';

type CreateMutationInput = {
  shape: NodeShape;
  description: NodeDescriptionValue;
};

type UpdateMutationInput = {
  id: string;
  shape: NodeShape;
  updates: NodeDescriptionValue;
};

type DeleteMutationInput = {
  shape: NodeShape;
  ids: NodeReferenceValue[];
};

const toNodeReference = (value: NodeReferenceValue): NodeReferenceValue => ({
  id: value.id,
});

const toSetModification = (value: SetModificationValue): IRSetModificationValue => {
  return {
    add: value.$add
      ? value.$add.map((item) => toFieldValue(item as unknown as PropUpdateValue))
      : undefined,
    remove: value.$remove ? value.$remove.map((item) => toNodeReference(item)) : undefined,
  };
};

const toSingleFieldValue = (value: SinglePropertyUpdateValue): IRFieldValue => {
  if (value === undefined) {
    return undefined;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Date
  ) {
    return value;
  }

  if ('id' in (value as NodeReferenceValue)) {
    return toNodeReference(value as NodeReferenceValue);
  }

  return toNodeDescription(value as NodeDescriptionValue);
};

const toFieldValue = (value: PropUpdateValue): IRFieldValue => {
  if (Array.isArray(value)) {
    return value.map((item) => toSingleFieldValue(item));
  }

  if (isSetModificationValue(value)) {
    return toSetModification(value);
  }

  return toSingleFieldValue(value);
};

const toNodeField = (field: NodeDescriptionValue['fields'][number]): IRNodeFieldUpdate => {
  return {
    property: {propertyShapeId: field.prop.id},
    value: toFieldValue(field.val),
  };
};

const toNodeDescription = (description: NodeDescriptionValue): IRNodeDescription => {
  return {
    shape: {shapeId: description.shape.id},
    fields: description.fields.map(toNodeField),
    ...(description.__id ? {id: description.__id} : {}),
  };
};

export const buildCanonicalCreateMutationIR = (
  query: CreateMutationInput,
): IRCreateMutation => {
  return {
    kind: 'create_mutation',
    shape: {shapeId: query.shape.id},
    description: toNodeDescription(query.description),
  };
};

export const buildCanonicalUpdateMutationIR = (
  query: UpdateMutationInput,
): IRUpdateMutation => {
  return {
    kind: 'update_mutation',
    shape: {shapeId: query.shape.id},
    id: query.id,
    updates: toNodeDescription(query.updates),
  };
};

export const buildCanonicalDeleteMutationIR = (
  query: DeleteMutationInput,
): IRDeleteMutation => {
  return {
    kind: 'delete_mutation',
    shape: {shapeId: query.shape.id},
    ids: query.ids.map((id) => ({id: id.id})),
  };
};

