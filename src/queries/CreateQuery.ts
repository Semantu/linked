import {Shape} from '../shapes/Shape.js';
import {NodeShape} from '../shapes/SHACL.js';
import {LinkedQuery} from './SelectQuery.js';
import {AddId, NodeDescriptionValue, UpdatePartial} from './QueryFactory.js';
import {MutationQueryFactory} from './MutationQuery.js';
import {IRCreateMutation} from './IntermediateRepresentation.js';
import {buildCanonicalCreateMutationIR} from './IRMutation.js';

/**
 * The canonical CreateQuery type — an IR AST node representing a create mutation.
 * This is the type received by IQuadStore.createQuery().
 */
export type CreateQuery = IRCreateMutation;

/**
 * @deprecated Legacy flat create query format — used internally by mutation IR builders.
 */
export interface LegacyCreateQuery<ResponseType = null> extends LinkedQuery {
  type: 'create';
  shape: NodeShape;
  description: NodeDescriptionValue;
}

export type CreateResponse<U> = AddId<U, true>;

export class CreateQueryFactory<
  ShapeType extends Shape,
  U extends UpdatePartial<ShapeType>,
> extends MutationQueryFactory {
  readonly id: string;
  readonly description: NodeDescriptionValue;

  constructor(
    public shapeClass: typeof Shape,
    updateObjectOrFn: U,
  ) {
    super();
    this.description = this.convertUpdateObject(
      updateObjectOrFn,
      this.shapeClass.shape,
      true,
    );
  }

  getLegacyQueryObject(): LegacyCreateQuery<AddId<U, true>> {
    return {
      type: 'create',
      shape: this.shapeClass.shape,
      description: this.description,
    };
  }

  getQueryObject(): IRCreateMutation {
    return buildCanonicalCreateMutationIR(this.getLegacyQueryObject());
  }
}
