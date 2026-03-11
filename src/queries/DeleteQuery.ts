import {Shape, ShapeConstructor} from '../shapes/Shape.js';
import {NodeReferenceValue, UpdatePartial} from './QueryFactory.js';
import {MutationQueryFactory, NodeId} from './MutationQuery.js';
import {
  IRDeleteMutation,
  IRDeleteAllMutation,
  IRDeleteWhereMutation,
} from './IntermediateRepresentation.js';
import {buildCanonicalDeleteMutationIR} from './IRMutation.js';

/**
 * The canonical DeleteQuery type — an IR AST node representing a delete mutation.
 * This is the type received by IQuadStore.deleteQuery().
 */
export type DeleteQuery = IRDeleteMutation | IRDeleteAllMutation | IRDeleteWhereMutation;

export type DeleteResponse = {
  /**
   * The IDs of the items that were successfully deleted.
   */
  deleted: NodeReferenceValue[];
  /**
   * The number of successfully deleted items.
   */
  count: number;
  /**
   * The IDs of the items that couldn't be deleted.
   */
  failed?: NodeReferenceValue[];
  /**
   * A mapping of IDs to error messages for the items that couldn't be deleted.
   */
  errors?: Record<string, string>;
};

export class DeleteQueryFactory<
  ShapeType extends Shape,
  U extends UpdatePartial<ShapeType>,
> extends MutationQueryFactory {
  readonly id: string;
  readonly ids: NodeReferenceValue[];

  constructor(
    public shapeClass: ShapeConstructor<ShapeType>,
    ids: NodeId[] | NodeId,
  ) {
    super();
    this.ids = this.convertNodeReferences(ids);
  }

  build(): DeleteQuery {
    return buildCanonicalDeleteMutationIR({
      shape: this.shapeClass.shape,
      ids: this.ids,
    });
  }
}
