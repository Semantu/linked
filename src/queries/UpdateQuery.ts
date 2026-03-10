import {Shape, ShapeConstructor} from '../shapes/Shape.js';
import {
  AddId,
  NodeDescriptionValue,
  NodeReferenceValue,
  UpdatePartial,
  toNodeReference,
} from './QueryFactory.js';
import {MutationQueryFactory} from './MutationQuery.js';
import {IRUpdateMutation} from './IntermediateRepresentation.js';
import {buildCanonicalUpdateMutationIR} from './IRMutation.js';

/**
 * The canonical UpdateQuery type — an IR AST node representing an update mutation.
 * This is the type received by IQuadStore.updateQuery().
 */
export type UpdateQuery = IRUpdateMutation;

export class UpdateQueryFactory<
  ShapeType extends Shape,
  U extends UpdatePartial<ShapeType>,
> extends MutationQueryFactory {
  readonly id: string;
  readonly fields: NodeDescriptionValue;

  constructor(
    public shapeClass: ShapeConstructor<ShapeType>,
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

  build(): UpdateQuery {
    return buildCanonicalUpdateMutationIR({
      id: this.id,
      shape: this.shapeClass.shape,
      updates: this.fields,
    });
  }
}
