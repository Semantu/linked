import {Shape} from '../shapes/Shape.js';
import {
  AddId,
  NodeDescriptionValue,
  NodeReferenceValue,
  UpdatePartial,
  toNodeReference,
} from './QueryFactory.js';
import {NodeShape} from '../shapes/SHACL.js';
import {MutationQueryFactory} from './MutationQuery.js';
import {IRUpdateMutation} from './IntermediateRepresentation.js';
import {buildCanonicalUpdateMutationIR} from './IRMutation.js';

/**
 * The canonical UpdateQuery type — an IR AST node representing an update mutation.
 * This is the type received by IQuadStore.updateQuery().
 */
export type UpdateQuery = IRUpdateMutation;

/**
 * @deprecated Legacy flat update query format — used internally by mutation IR builders.
 */
export type LegacyUpdateQuery<ResponseType = null> = {
  type: 'update';
  id: string;
  shape: NodeShape;
  updates: NodeDescriptionValue;
};

export class UpdateQueryFactory<
  ShapeType extends Shape,
  U extends UpdatePartial<ShapeType>,
> extends MutationQueryFactory {
  readonly id: string;
  readonly fields: NodeDescriptionValue;

  constructor(
    public shapeClass: typeof Shape,
    id: string | NodeReferenceValue,
    updateObjectOrFn: U,
  ) {
    super();
    this.id = toNodeReference(id).id;
    this.fields = this.convertUpdateObject(
      updateObjectOrFn,
      this.shapeClass.shape,
    );
  }

  getLegacyQueryObject(): LegacyUpdateQuery<AddId<U>> {
    return {
      type: 'update',
      id: this.id,
      shape: this.shapeClass.shape,
      updates: this.fields,
    };
  }

  build(): UpdateQuery {
    return buildCanonicalUpdateMutationIR(this.getLegacyQueryObject());
  }

  /** @deprecated Use build() */
  getQueryObject(): UpdateQuery {
    return this.build();
  }
}
