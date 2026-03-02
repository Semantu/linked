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
  IRNodeData,
  IRFieldUpdate,
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

  return toNodeData(value as NodeDescriptionValue);
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

const toFieldUpdate = (field: NodeDescriptionValue['fields'][number]): IRFieldUpdate => {
  return {
    property: field.prop.id,
    value: toFieldValue(field.val),
  };
};

const toNodeData = (description: NodeDescriptionValue): IRNodeData => {
  return {
    shape: description.shape.id,
    fields: description.fields.map(toFieldUpdate),
    ...(description.__id ? {id: description.__id} : {}),
  };
};

/** Builds an IRCreateMutation from a create factory's internal description. */
export const buildCanonicalCreateMutationIR = (
  query: CreateMutationInput,
): IRCreateMutation => {
  return {
    kind: 'create',
    shape: query.shape.id,
    data: toNodeData(query.description),
  };
};

/** Builds an IRUpdateMutation from an update factory's internal description. */
export const buildCanonicalUpdateMutationIR = (
  query: UpdateMutationInput,
): IRUpdateMutation => {
  return {
    kind: 'update',
    shape: query.shape.id,
    id: query.id,
    data: toNodeData(query.updates),
  };
};

/** Builds an IRDeleteMutation from a delete factory's internal description. */
export const buildCanonicalDeleteMutationIR = (
  query: DeleteMutationInput,
): IRDeleteMutation => {
  return {
    kind: 'delete',
    shape: query.shape.id,
    ids: query.ids.map((id) => ({id: id.id})),
  };
};
