import {IQueryParser, staticImplements} from '../interfaces/IQueryParser.js';
import {
  GetQueryResponseType,
  QueryResponseToResultType,
  SelectQueryFactory,
} from './SelectQuery.js';
import {AddId, NodeReferenceValue, UpdatePartial} from './QueryFactory.js';
import {Shape} from '../shapes/Shape.js';
import {LinkedStorage} from '../utils/LinkedStorage.js';
import {UpdateQueryFactory} from './UpdateQuery.js';
import {CreateQueryFactory, CreateResponse} from './CreateQuery.js';
import {DeleteQueryFactory, DeleteResponse} from './DeleteQuery.js';
import {NodeId} from './MutationQuery.js';
import {
  buildCanonicalCreateMutationIR,
  buildCanonicalDeleteMutationIR,
  buildCanonicalUpdateMutationIR,
} from './IRMutation.js';

@staticImplements<IQueryParser>() /* this class implements this interface with static methods */
export class QueryParser {
  static async selectQuery<
    ShapeType extends Shape,
    ResponseType,
    Source,
    ResultType = QueryResponseToResultType<
      GetQueryResponseType<SelectQueryFactory<ShapeType, ResponseType>>,
      ShapeType
    >[],
  >(
    query: SelectQueryFactory<ShapeType, ResponseType, Source>,
  ): Promise<ResultType> {
    try {
      return LinkedStorage.selectQuery(query.getIR());
    } catch (e) {
      return Promise.reject(e);
    }
  }

  static updateQuery<
    ShapeType extends Shape,
    U extends UpdatePartial<ShapeType>,
  >(
    id: string | NodeReferenceValue,
    updateObjectOrFn: U,
    shapeClass: typeof Shape,
  ): Promise<AddId<U>> {
    const query = new UpdateQueryFactory<ShapeType, U>(
      shapeClass,
      id,
      updateObjectOrFn,
    );
    const irQuery = buildCanonicalUpdateMutationIR(query.getQueryObject());
    return LinkedStorage.updateQuery(irQuery);
  }

  static createQuery<
    ShapeType extends Shape,
    U extends UpdatePartial<ShapeType>,
  >(updateObjectOrFn: U, shapeClass: typeof Shape): Promise<CreateResponse<U>> {
    try {
      const query = new CreateQueryFactory<ShapeType, U>(
        shapeClass,
        updateObjectOrFn,
      );
      const irQuery = buildCanonicalCreateMutationIR(query.getQueryObject());
      return LinkedStorage.createQuery(irQuery);
    } catch (e) {
      console.warn(e);
    }
  }

  static deleteQuery(
    id: NodeId | NodeId[] | NodeReferenceValue[],
    shapeClass: typeof Shape,
  ): Promise<DeleteResponse> {
    const query = new DeleteQueryFactory<Shape, {}>(shapeClass, id);
    const irQuery = buildCanonicalDeleteMutationIR(query.getQueryObject());
    return LinkedStorage.deleteQuery(irQuery);
  }
}

Shape.queryParser = QueryParser;
