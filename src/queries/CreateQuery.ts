import {Shape, ShapeConstructor} from '../shapes/Shape.js';
import {AddId, NodeDescriptionValue, UpdatePartial} from './QueryFactory.js';
import {MutationQueryFactory} from './MutationQuery.js';
import {IRCreateMutation} from './IntermediateRepresentation.js';
import {buildCanonicalCreateMutationIR} from './IRMutation.js';

/**
 * The canonical CreateQuery type — an IR AST node representing a create mutation.
 * This is the type received by IQuadStore.createQuery().
 */
export type CreateQuery = IRCreateMutation;

export type CreateResponse<U> = AddId<U, true>;

export class CreateQueryFactory<
  ShapeType extends Shape,
  U extends UpdatePartial<ShapeType>,
> extends MutationQueryFactory {
  readonly id: string;
  readonly description: NodeDescriptionValue;

  constructor(
    public shapeClass: ShapeConstructor<ShapeType>,
    updateObjectOrFn: U,
  ) {
    super();
    this.description = this.convertUpdateObject(
      updateObjectOrFn,
      this.shapeClass.shape,
      true,
    );
  }

  build(): CreateQuery {
    return buildCanonicalCreateMutationIR({
      shape: this.shapeClass.shape,
      description: this.description,
    });
  }
}
