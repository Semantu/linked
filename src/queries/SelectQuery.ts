import {Shape, ShapeConstructor} from '../shapes/Shape.js';
import type {PropertyShape} from '../shapes/SHACL.js';
import {ShapeSet} from '../collections/ShapeSet.js';
import {shacl} from '../ontologies/shacl.js';
import {CoreSet} from '../collections/CoreSet.js';
import {CoreMap} from '../collections/CoreMap.js';
import {getPropertyShapeByLabel,getShapeClass} from '../utils/ShapeClass.js';
import {NodeReferenceValue,Prettify,ShapeReferenceValue} from './QueryFactory.js';
import {xsd} from '../ontologies/xsd.js';
import type {IRSelectQuery} from './IntermediateRepresentation.js';
import {createProxiedPathBuilder} from './ProxiedPathBuilder.js';
import {FieldSet} from './FieldSet.js';
import {PropertyPath} from './PropertyPath.js';
import type {QueryBuilder} from './QueryBuilder.js';
import {ExpressionNode, ExistsCondition, isExpressionNode, isExistsCondition, tracedPropertyExpression, tracedAliasExpression} from '../expressions/ExpressionNode.js';

/**
 * The canonical SelectQuery type — an IR AST node representing a select query.
 * This is the type received by IQuadStore.selectQuery().
 */
export type SelectQuery = IRSelectQuery;

/**
 * ###################################
 * #### TYPES FOR QUERY BUILDING  ####
 * ###################################
 */
export type JSPrimitive = JSNonNullPrimitive | null | undefined;
export type JSNonNullPrimitive = string | number | boolean | Date;

const isSameRef = (
  a?: NodeReferenceValue,
  b?: NodeReferenceValue,
): boolean => !!a && !!b && a.id === b.id;

export type SingleResult<ResultType> =
  ResultType extends Array<infer R>
    ? R
    : ResultType extends Set<infer R>
      ? R
      : ResultType;

/**
 * All the possible types that a regular get/set method of a Shape can return
 */
export type AccessorReturnValue =
  | Shape
  | ShapeSet
  | JSPrimitive
  | NodeReferenceValue;

export type WhereClause<S extends Shape | AccessorReturnValue> =
  | Evaluation
  | ExpressionNode
  | ExistsCondition
  | ((s: ToQueryBuilderObject<S>) => Evaluation | ExpressionNode | ExistsCondition);

export type QueryBuildFn<T extends Shape, ResponseType> = (
  p: ToQueryBuilderObject<T>,
) => ResponseType;

export type QueryWrapperObject<ShapeType extends Shape = any> = {
  [key: string]: FieldSet<any, any>;
};

export type SortByPath = {
  paths: PropertyPath[];
  direction: 'ASC' | 'DESC';
};

/**
 * A property-only query path, used by where/sort proxy tracing.
 */
export type QueryPropertyPath = QueryStep[];

/**
 * A QueryStep is a single step in a query path.
 */
export type QueryStep =
  | PropertyQueryStep
  | SizeStep
  | ShapeReferenceValue;
export type SizeStep = {
  count: QueryPropertyPath;
  label?: string;
};
export type PropertyQueryStep = {
  property: PropertyShape;
  where?: WherePath;
};

export type WhereAndOr = {
  firstPath: WherePath;
  andOr: AndOrQueryToken[];
};

/**
 * A WhereQuery is a (sub)query that is used to filter down the results of its parent query.
 */
export type AndOrQueryToken = {
  and?: WherePath;
  or?: WherePath;
};

export enum WhereMethods {
  EQUALS = '=',
  SOME = 'some',
  EVERY = 'every',
}

/**
 * Maps all the return types of get/set methods of a Shape and maps their return types to QueryBuilderObjects
 */
export type QueryShapeProps<
  T extends Shape,
  Source,
  Property extends string | number | symbol = any,
> = {
  [P in keyof T]: ToQueryBuilderObject<T[P], QShape<T, Source, Property>, P>;
};

export type SelectAllQueryResponse<T extends Shape> = Array<
  QueryShapeProps<T, null, ''>[Exclude<
    Extract<
      {
        [K in keyof T]-?: T[K] extends (...args: any[]) => any ? never : K;
      }[keyof T],
      string
    >,
    Extract<keyof Shape, string>
  >]
>;

/**
 * This type states that the ShapeSet has access to the same methods as the shape of all the items in the set
 * (this is enabled with the QueryShapeSet.proxifyShapeSet method)
 * Each value of the shape is converted to a QueryBuilderObject
 */
export type QueryShapeSetProps<SourceShapeSet, Shape> = {
  [P in keyof Shape]: ToQueryBuilderObject<Shape[P], SourceShapeSet, P>;
};

/**
 * ShapeSets are converted to QueryShapeSets, but also inherit all the properties of the shape that each item in the set has (with converted result types)
 */
export type QShapeSet<
  ShapeSetType extends Shape,
  Source = null,
  Property extends string | number | symbol = null,
> = QueryShapeSet<ShapeSetType, Source, Property> &
  QueryShapeSetProps<
    QueryShapeSet<ShapeSetType, Source, Property>,
    ShapeSetType
  >;

/**
 * Shapes are converted to QueryShapes, but also inherit all the properties of the shape (with converted result types)
 */
export type QShape<
  T extends Shape,
  Source = any,
  Property extends string | number | symbol = any,
> = QueryShape<T, Source, Property> & QueryShapeProps<T, Source, Property>;

export type ToQueryBuilderObject<
  T,
  Source = null,
  Property extends string | number | symbol = '',
> =
  T extends ShapeSet<infer ShapeSetType>
    ? QShapeSet<ShapeSetType, Source, Property>
    : T extends Shape
      ? QShape<T, Source, Property>
      : T extends string | number | Date | boolean
        ? ToQueryPrimitive<T, Source, Property>
        : // : QueryBuilderObject<T,Source,Property>;
          T extends Array<infer AT>
          ? AT extends Date | string | number
            ? QueryPrimitiveSet<ToQueryPrimitive<AT, Source, Property>>
            : AT extends boolean
              ? QueryPrimitive<boolean>
              : AT[]
          : //added support for get/set methods that return NodeReferenceValue, treating them as plain Shapes
            T extends NodeReferenceValue
            ? QShape<Shape, Source, Property>
            : QueryBuilderObject<T, Source, Property>;

export type ToQueryPrimitive<
  T extends string | number | Date | boolean,
  Source,
  Property extends string | number | symbol = '',
> = T extends string
  ? QueryPrimitive<string, Source, Property>
  : T extends number
    ? QueryPrimitive<number, Source, Property>
    : T extends Date
      ? QueryPrimitive<Date, Source, Property>
      : T extends boolean
        ? QueryPrimitive<boolean, Source, Property>
        : never & {__error: 'ToQueryPrimitive: no matching primitive type'};

export type WhereExpressionPath = {
  expressionNode: ExpressionNode;
};

export type WhereExistsPath = {
  existsCondition: ExistsCondition;
};

export type WherePath = WhereEvaluationPath | WhereAndOr | WhereExpressionPath | WhereExistsPath;

export type WhereEvaluationPath = {
  path: QueryPropertyPath;
  method: WhereMethods;
  args: QueryArg[];
};

// WherePath can also be an and/or wrapper; use this guard to safely access args.
export const isWhereEvaluationPath = (
  value: WherePath,
): value is WhereEvaluationPath => {
  return !!value && 'args' in value;
};

/**
 * An argument can be a direct reference to a node, a js primitive (boolean,number), a path to resolve (like from a query context variables)
 * Or a wherePath in the case of some() or every() (e.g. x.where(x.friends.some(f => f.age > 18) -> the argument is a wherePath)
 */
export type QueryArg =
  | NodeReferenceValue
  | JSNonNullPrimitive
  | ArgPath
  | WherePath;
export type ArgPath = {
  path: QueryPropertyPath;
  subject: ShapeReferenceValue;
};


export type QueryComponentLike<ShapeType extends Shape, CompQueryResult> = {
  query:
    | QueryBuilder<ShapeType>
    | FieldSet
    | Record<string, QueryBuilder<ShapeType>>;
  fields?: FieldSet;
};

/**
 * Interface that linked components (e.g. from `@_linked/react`'s `linkedComponent()`)
 * must satisfy to participate in preloadFor.
 *
 * Components expose their data requirements as a QueryBuilder,
 * and optionally a FieldSet for declarative field access.
 */
export interface LinkedComponentInterface<S extends Shape = Shape, R = any> {
  /** The component's data query (QueryBuilder template, not executed). */
  query: QueryBuilder<S, any, R>;
  /** The component's field requirements as a FieldSet. */
  fields?: FieldSet;
}

/**
 * ###################################
 * ####    QUERY RESULT TYPES     ####
 * ###################################
 */

export type NodeResultMap = CoreMap<string, QResult<any, any>>;

export type QResult<ShapeType extends Shape = Shape, Object = {}> = Object & {
  id: string;
  // shape?: ShapeType;
};

export type QueryControllerProps = {
  query?: QueryController;
};
export type QueryController = {
  nextPage: () => void;
  previousPage: () => void;
  setLimit: (limit: number) => void;
  setPage: (page: number) => void;
};


export type GetCustomObjectKeys<T> = T extends QueryWrapperObject
  ? {
      [P in keyof T]: T[P] extends FieldSet<any, any>
        ? ToQueryResultSet<T[P]>
        : never;
    }
  : [];

export type ToQueryResultSet<T> =
  T extends FieldSet<infer ResponseType, any>
    ? QueryResponseToResultType<ResponseType>[]
    : null;

/**
 * MAIN ENTRY to convert the response of a query into a result object
 */
export type QueryResponseToResultType<
  T,
  QShapeType extends Shape = null,
  HasName = false,
> = T extends QueryBuilderObject
  ? GetQueryObjectResultType<T, {}, false, HasName>
  : T extends FieldSet<infer Response, infer Source>
    ? GetNestedQueryResultType<Response, Source>
    : T extends Array<infer Type>
      ? UnionToIntersection<QueryResponseToResultType<Type>>
      : T extends ExpressionNode
        ? boolean
        : T extends Evaluation
          ? boolean
          : T extends Object
          ? QResult<QShapeType, Prettify<ObjectToPlainResult<T>>>
          : never & {__error: 'QueryResponseToResultType: unmatched query response type'};

/**
 * Turns a QueryBuilderObject into a plain JS object
 * @param QV the query value type
 * @param SubProperties to add extra properties into the result object (used to merge arrays into objects for example)
 * @param SourceOverwrite if the source of the query value should be overwritten
 */
export type GetQueryObjectResultType<
  QV,
  SubProperties = {},
  PrimitiveArray = false,
  HasName = false,
> =
  //note: count needs to be above primitive
  QV extends SetSize<infer Source>
    ? SetSizeToQueryResult<Source, HasName>
    : QV extends QueryPrimitive<infer Primitive, infer Source, infer Property>
      ? CreateQResult<
          Source,
          PrimitiveArray extends true ? Primitive[] : Primitive,
          Property,
          {},
          HasName
        >
      : QV extends QueryShape<infer ShapeType, infer Source, infer Property>
        ? CreateQResult<Source, ShapeType, Property, SubProperties, HasName>
        : QV extends BoundComponent<infer Source, infer CompQueryResult>
          ? GetQueryObjectResultType<
              Source,
              SubProperties & QueryResponseToResultType<CompQueryResult>,
              PrimitiveArray,
              HasName
            >
          : QV extends QueryShapeSet<
              infer ShapeType,
              infer Source,
              infer Property
            >
            ? CreateShapeSetQResult<
                ShapeType,
                Source,
                Property,
                SubProperties,
                HasName
              >
            : QV extends QueryPrimitiveSet<
                  infer QPrim extends QueryPrimitive<any>
                >
              ? GetQueryObjectResultType<QPrim, null, null, true>
              : QV extends Array<infer Type>
                ? UnionToIntersection<QueryResponseToResultType<Type>>
                : QV extends QueryPrimitive<boolean, any, any>
                  ? 'bool'
                  : never & {__error: 'GetQueryObjectResultType: unmatched query value type'};

export type GetShapesResultTypeWithSource<Source> =
  QueryResponseToResultType<Source>;

type GetQueryObjectProperty<T> =
  T extends QueryBuilderObject<any, any, infer Property>
    ? Property
    : T extends FieldSet<infer SubResponse, infer SubSource>
      ? GetQueryObjectProperty<SubSource>
      : never;
type GetQueryObjectOriginal<T> =
  T extends QueryBuilderObject<infer Original>
    ? Original
    : T extends FieldSet<infer SubResponse, infer SubSource>
      ? GetNestedQueryResultType<SubResponse, SubSource>
      : never;
/**
 * Converts an intersection of QueryBuilderObjects into a plain JS object
 * i.e. QueryPrimitive<string,Person,"name"> | QueryPrimitive<string,Person,"hobby"> --> {name: string, hobby: string}
 * To do this we get the Property of each QueryBuilderObject, and use it as the key in the resulting object
 * and, we get the Original type of each QueryBuilderObject, and use it as the value in the resulting object
 */
type QueryValueIntersectionToObject<Items> = {
  [Type in Items as GetQueryObjectProperty<Type>]: true; //GetQueryObjectOriginal<Type>;
};

export type SetSizeToQueryResult<Source, HasName = false> =
  Source extends QueryShapeSet<
    infer ShapeType,
    infer ParentSource,
    infer SourceProperty
  >
    ? HasName extends false
      ? //when we count something and we already know what the name of the variable of the resulting number is, then we return a number
        //But if we count a shapeset and its NOT in a custom object where a key (name) is already known, then we return a QResult
        //This QResult will be the same as it would be if there was no .count() statement. Except now it returns a number (hence we send number as value type)
        CreateQResult<ParentSource, number, SourceProperty>
      : number
    : number;

/**
 * If the source is an object (it extends shape)
 * then the result is a plain JS Object, with Property as its key, with type Value
 */
export type CreateQResult<
  Source,
  Value = undefined,
  Property extends string | number | symbol = '',
  SubProperties = {},
  HasName = false,
> =
  Source extends QueryShape<
    infer SourceShapeType,
    infer ParentSource,
    infer SourceProperty
  >
    ? //if the parent source is null, that means this is the final source-node in the query
      ParentSource extends null
      ? HasName extends true
        ? Value
        : //TODO: this must be simplified and rewritten
          // it is likely the most complex part of the type system currently
          // It turns out that sub-.select() on a QueryShapeSet ends up here with Value being null, and sub properties need to be added to the QResult itself
          // Whilst sub-.select() on a single QueryShape ends up here with Value being defined, in which case the SubProperties need to be included in the inner QResult
          Value extends null
          ? //hence we create a single QResult, but do not use CreateQResult (which will keep creating nested QResults)
            QResult<
              SourceShapeType,
              {
                //we pass Value and Value but not Property, so that when the value is a Shape or ShapeSet, there is recursion
                //but for all other cases (like string, number, boolean) the value is just passed through
                [P in Property]: CreateQResult<Value, Value>;
              } & SubProperties
            >
          : //hence we create a single QResult, but do not use CreateQResult (which will keep creating nested QResults)
            QResult<
              SourceShapeType,
              {
                //we pass Value and Value but not Property, so that when the value is a Shape or ShapeSet, there is recursion
                //but for all other cases (like string, number, boolean) the value is just passed through
                [P in Property]: CreateQResult<Value, Value, '', SubProperties>;
              }
            >
      : CreateQResult<
          ParentSource,
          QResult<
            SourceShapeType,
            {
              //we pass Value and Value but not Property, so that when the value is a Shape or ShapeSet, there is recursion
              //but for all other cases (like string, number, boolean) the value is just passed through
              [P in Property]: CreateQResult<Value, Value>;
            } & SubProperties
          >,
          SourceProperty,
          {},
          HasName
        >
    : Source extends QueryShapeSet<
          infer ShapeType,
          infer ParentSource,
          infer SourceProperty
        >
      ? //for a ShapeSet, we make the current result (a QResult) the value of a parent QResult (created with ToQueryResult)
        CreateQResult<
          ParentSource,
          QResult<
            ShapeType,
            {
              //we pass Value and Value but not Property, so that when the value is a Shape or ShapeSet, there is recursion
              //but for all other cases (like string, number, boolean) the value is just passed through
              [P in Property]: CreateQResult<Value, Value, null, SubProperties>;
            }
          >[],
          SourceProperty,
          {},
          HasName
        >
      : //Source is not a QueryShape or QueryShape set (currently sometimes used by end QueryPrimitives) ..
        // this needs to convert to value (amongst other things) for .select({customKeys}) and ObjectToPlainResult
        Value extends Shape
        ? QResult<Value, SubProperties>
        : // : Value extends boolean ? 'boolean' : Value;
          NormaliseBoolean<Value>;

type NormaliseBoolean<T> = [T] extends [boolean] ? boolean : T;

export type CreateShapeSetQResult<
  ShapeType = undefined,
  Source = undefined,
  Property extends string | number | symbol = '',
  SubProperties = {},
  HasName = false,
> =
  Source extends QueryShape<infer SourceShapeType, infer ParentSource>
    ? //if HasName is true and source is a QueryShape, but ITS source (ParentSource) is null
      //then we don't want to create a nested QResult, but instead we ignore this last property and we return an array of QResults of this source
      //This is used by custom object keys with values like: p.friends, which should return an array of QResult<Person> Objects, not a {friends:...} QResult
      //NOTE: this notation check if 2 statements are true: HasName is true, and ParentSource is null
      [HasName, ParentSource] extends [true, null]
      ? CreateQResult<Source, null, null>[]
      : ParentSource extends null
        ? QResult<
            SourceShapeType,
            {[P in Property]: CreateQResult<Source, null, null, SubProperties>[]}
          >
        : //when ParentSource is not null, we need to continue unwinding the source chain
          //Pass the inner ShapeSet items as SubProperties so they stay at the correct nesting level
          CreateQResult<
            Source,
            null,
            null,
            {[P in Property]: (ShapeType extends Shape ? QResult<ShapeType, SubProperties> : QResult<Shape, SubProperties>)[]}
          >
    : Source extends QueryShapeSet<
          infer ShapeType,
          infer ParentSource,
          infer SourceProperty
        >
      ? //for a shapeset source, we make the current result (a QResult) the value of a parent QResult (created with ToQueryResult)
        CreateQResult<
          ParentSource,
          QResult<
            ShapeType,
            {
              [P in Property]: CreateQResult<ShapeType>[];
            }
          >[],
          SourceProperty,
          {},
          HasName
        >
      : CreateQResult<ShapeType>;

/**
 * Ignores the source and property, and returns the converted value
 */
export type ObjectToPlainResult<T> = {
  //passing true as sourceOverwrite will mean that the original source is ignored and so the converted value will not be wrapped in a QResult
  // [P in keyof T]: QueryResponseToResultType<T[P], null, true>;
  [P in keyof T]: QueryResponseToResultType<T[P], null, true>;
};

export type GetSource<Source, Overwrite> = Overwrite extends null
  ? Source
  : Overwrite;

type GetNestedQueryResultType<Response, Source> =
  Source extends QueryBuilderObject
    ? //if the linked query originates from within another query (like with select())
      //then we turn the source into a result. And then pass the selected properties as "SubProperties"
      //regardless of whether the response type is an array or object, it gets converted into a result value object
      GetQueryObjectResultType<Source, QueryResponseToResultType<Response>>
    : //by default: we just convert the response type into a result value object
      QueryResponseToResultType<Response>[];

//https://stackoverflow.com/a/50375286/977206
type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (
  x: infer I,
) => void
  ? I
  : never;

/**
 * Converts the response of a nested query into a QResult object
 */
type ResponseToObject<R> =
  R extends Array<infer Type extends QueryBuilderObject>
    ? QueryValueIntersectionToObject<Type>
    : Prettify<ObjectToPlainResult<R>>;

export type GetQueryResponseType<Q> =
  Q extends FieldSet<infer ResponseType, any> ? ResponseType : Q;

/**
 * ###################################
 * ####  QUERY BUILDING CLASSES   ####
 * ###################################
 */

export class QueryBuilderObject<
  OriginalValue = any,
  Source = any,
  Property extends string | number | symbol = any,
> {
  //is null by default to avoid warnings when trying to access wherePath when its undefined
  wherePath?: WherePath = null;
  protected originalValue?: OriginalValue;
  protected source: Source;
  protected prop: Property;

  constructor(
    public property?: PropertyShape,
    public subject?: QueryShape<any> | QueryShapeSet<any> | QueryPrimitiveSet,
  ) {}

  /**
   * Converts an original value into a query value
   * @param originalValue
   * @param requestedPropertyShape the property shape that is connected to the get accessor that returned the original value
   */
  static convertOriginal(
    originalValue: AccessorReturnValue,
    property: PropertyShape,
    subject: QueryShape<any> | QueryShapeSet<any> | QueryShape<any>,
  ): QueryBuilderObject {
    if (originalValue instanceof Shape) {
      return QueryShape.create(originalValue, property, subject);
    } else if (originalValue instanceof ShapeSet) {
      return QueryShapeSet.create(originalValue, property, subject);
    } else if (typeof originalValue === 'string') {
      return new QueryPrimitive<string>(originalValue, property, subject);
    } else if (typeof originalValue === 'number') {
      return new QueryPrimitive<number>(originalValue, property, subject);
    } else if (typeof originalValue === 'boolean') {
      return new QueryPrimitive<boolean>(originalValue, property, subject);
    } else if (originalValue instanceof Date) {
      return new QueryPrimitive<Date>(originalValue, property, subject);
    } else if (Array.isArray(originalValue)) {
      return new QueryPrimitiveSet(originalValue, property, subject);
    } else if (
      originalValue &&
      typeof originalValue === 'object' &&
      'id' in originalValue
    ) {
      //Support accessors that return NodeReferenceValue when a value shape is known.
      if (property.valueShape) {
        const shapeClass = getShapeClass(property.valueShape);
        if (!shapeClass) {
          throw new Error(
            `Shape class not found for ${property.valueShape.id}`,
          );
        }
        const shape = new shapeClass();
        shape.id = (originalValue as NodeReferenceValue).id;
        return QueryShape.create(shape, property, subject);
      }
      throw new Error(
        subject.getOriginalValue().nodeShape.label +
          '.' +
          property.label +
          ': A property accessor should return a Shape or a primitive value. Returning a NodeReferenceValue is currently not supported.',
      );
    } else {
      throw new Error('Unknown query path result type: ' + originalValue);
    }
  }

  /**
   * Create a Query Builder Object based on the requested PropertyShape
   */
  static generatePathValue(
    // originalValue: AccessorReturnValue,
    property: PropertyShape,
    subject: QueryShape<any> | QueryShapeSet<any> | QueryShape<any>,
  ): QueryBuilderObject {
    let datatype = property.datatype;
    let valueShape = property.valueShape;
    let singleValue = property.maxCount <= 1;
    if (datatype) {
      if (singleValue) {
        if (isSameRef(datatype, xsd.integer)) {
          return wrapWithExpressionProxy(new QueryPrimitive<number>(0, property, subject));
        } else if (isSameRef(datatype, xsd.boolean)) {
          return wrapWithExpressionProxy(new QueryPrimitive<boolean>(false, property, subject));
        } else if (
          isSameRef(datatype, xsd.dateTime) ||
          isSameRef(datatype, xsd.date)
        ) {
          return wrapWithExpressionProxy(new QueryPrimitive<Date>(new Date(), property, subject));
        } else if (isSameRef(datatype, xsd.string)) {
          return wrapWithExpressionProxy(new QueryPrimitive<string>('', property, subject));
        }
      } else {
        //TODO review this, do we need property & subject in both of these? currently yes, but why
        return new QueryPrimitiveSet([''], property, subject, [
          new QueryPrimitive<string>('', property, subject),
        ]);
      }
    }
    if (valueShape) {
      const shapeClass = getShapeClass(valueShape);
      if(!shapeClass) {
        //TODO: getShapeClassAsync -> which will lazy load the shape class
        // but Im not sure if that's even possible with dynamic import paths, that are only known at runtime
        //UPDATE: we should not need to load shapeclasses. We just need to be able to access shapes.
        // but the problem remains that the ImageObject shape needs to be available, but thats easier, as its data
        throw new Error(`Shape class not found for ${valueShape.id}`);
      }
      const shapeValue = new shapeClass();
      if (singleValue) {
        return QueryShape.create(shapeValue, property, subject);
      } else {
        return QueryShapeSet.create(
          new ShapeSet([shapeValue]),
          property,
          subject,
        );
      }
    }

    //no value shape and no data type.
    //Lets look at the node kind
    if (
      isSameRef(property.nodeKind, shacl.Literal) ||
      isSameRef(property.nodeKind, shacl.BlankNodeOrLiteral)
    ) {
      if (singleValue) {
        //default to string if no datatype is set
        return wrapWithExpressionProxy(new QueryPrimitive<string>('', property, subject));
      } else {
        //TODO review this, do we need property & subject in both of these? currently yes, but why
        return new QueryPrimitiveSet([''], property, subject, [
          new QueryPrimitive<string>('', property, subject),
        ]);
      }
    }

    //if an object is expected and no value shape is set, then warn
    throw Error(
      `No shape set for objectProperty ${property.parentNodeShape.label}.${property.label}`,
    );
  }

  static getOriginalSource(
    endValue: ShapeSet<Shape> | Shape[] | QueryPrimitiveSet,
  ): // | QueryValueSetOfSets,
  ShapeSet;

  static getOriginalSource(endValue: Shape): Shape;

  static getOriginalSource(endValue: QueryPrimitive<any>): Shape | string;

  static getOriginalSource(
    endValue: string[] | QueryBuilderObject,
  ): Shape | ShapeSet;

  static getOriginalSource(
    endValue:
      | ShapeSet
      | Shape[]
      | Shape
      | string[]
      | QueryBuilderObject
      | QueryPrimitiveSet,
  ): AccessorReturnValue {
    if (typeof endValue === 'undefined') return undefined;
    if (endValue instanceof QueryPrimitiveSet) {
      return new ShapeSet(
        endValue.contents.map(
          (endValue) => this.getOriginalSource(endValue) as any as Shape,
        ),
      ) as ShapeSet;
    }
    if (endValue instanceof QueryPrimitive) {
      return endValue.subject
        ? this.getOriginalSource(endValue.subject as QueryShapeSet)
        : endValue.originalValue;
    }
    if (endValue instanceof QueryShape) {
      if (endValue.subject && !endValue.isSource) {
        return this.getOriginalSource(
          endValue.subject as QueryShape<any> | QueryShapeSet<any>,
        );
      }
      return endValue.originalValue;
    } else if (endValue instanceof Shape) {
      return endValue;
    } else if (endValue instanceof QueryShapeSet) {
      return new ShapeSet(
        (endValue as QueryShapeSet).queryShapes.map(
          (queryShape: QueryShape) =>
            this.getOriginalSource(queryShape) as Shape,
        ),
      );
    } else {
      throw new Error('Unimplemented. Return as is?');
    }
  }

  getOriginalValue() {
    return this.originalValue;
  }

  getPropertyStep(): QueryStep {
    return {
      property: this.property,
      where: this.wherePath,
    };
  }

  preloadFor<ShapeType extends Shape, CompQueryRes>(
    component: QueryComponentLike<ShapeType, CompQueryRes>,
  ): BoundComponent<this, CompQueryRes> {
    return new BoundComponent<this, CompQueryRes>(component, this);
  }

  limit(lim: number) {
  }

  /**
   * Returns the path of properties that were requested to reach this value
   */
  getPropertyPath(currentPath?: QueryPropertyPath): QueryPropertyPath {
    let path: QueryPropertyPath = currentPath || [];
    //add the step of this object to the beginning of the path (so that the next parent will always before the current item)
    if (this.property || this.wherePath) {
      path.unshift(this.getPropertyStep());
    }
    if (this.subject) {
      return this.subject.getPropertyPath(path);
    }
    //when query context is used as the first step, then the first step is just a pointer to the subject it represents
    if ((this.originalValue as Shape)?.__queryContextId) {
      path.unshift(convertQueryContext(this as any as QueryShape));
    }
    return path;
  }
}

export class BoundComponent<
  Source extends QueryBuilderObject,
  CompQueryResult = any,
> extends QueryBuilderObject {
  constructor(
    public originalValue: QueryComponentLike<any, CompQueryResult>,
    public source: Source,
  ) {
    super(null, null);
  }

}

/**
 * Converts query context to a ShapeReferenceValue
 */
const convertQueryContext = (shape: QueryShape): ShapeReferenceValue => {
  return {
    id: (shape.originalValue as Shape).__queryContextId,
    shape: {
      id: shape.originalValue.nodeShape.id,
    },
  } as ShapeReferenceValue;
};

export const processWhereClause = (
  validation: WhereClause<any>,
  shape?,
): WherePath => {
  if (validation instanceof Function) {
    if (!shape) {
      throw new Error('Cannot process where clause without shape');
    }
    const proxy = createProxiedPathBuilder(shape);
    const result = validation(proxy);
    if (isExpressionNode(result)) {
      return {expressionNode: result};
    }
    if (isExistsCondition(result)) {
      return {existsCondition: result};
    }
    return result.getWherePath();
  } else if (isExpressionNode(validation)) {
    return {expressionNode: validation};
  } else if (isExistsCondition(validation)) {
    return {existsCondition: validation};
  } else {
    return (validation as Evaluation).getWherePath();
  }
};

// ---------------------------------------------------------------------------
// Expression method proxy for QueryPrimitive
// ---------------------------------------------------------------------------

const EXPRESSION_METHODS = new Set([
  'plus', 'minus', 'times', 'divide', 'abs', 'round', 'ceil', 'floor', 'power',
  'equals', 'eq', 'neq', 'notEquals', 'gt', 'greaterThan', 'gte', 'greaterThanOrEqual',
  'lt', 'lessThan', 'lte', 'lessThanOrEqual',
  'concat', 'contains', 'startsWith', 'endsWith', 'substr', 'before', 'after',
  'replace', 'ucase', 'lcase', 'strlen', 'encodeForUri', 'matches',
  'year', 'month', 'day', 'hours', 'minutes', 'seconds', 'timezone', 'tz',
  'and', 'or', 'not',
  'isDefined', 'isNotDefined', 'defaultTo',
  'lang', 'datatype', 'str', 'iri', 'isIri', 'isLiteral', 'isBlank', 'isNumeric',
  'md5', 'sha256', 'sha512',
]);

/**
 * Convert a QueryBuilderObject to a traced ExpressionNode by extracting its
 * property path segments and creating a property expression reference.
 * This is the bridge between the query proxy world and the expression IR world.
 * Returns null if the object cannot be converted (e.g. root shape with no property path).
 */
function toExpressionNode(qbo: QueryBuilderObject): ExpressionNode | null {
  // Check if this is a query context reference
  const contextId = findContextId(qbo);
  if (contextId) {
    const segments = FieldSet.collectPropertySegments(qbo);
    if (segments.length > 0) {
      // Context property access (e.g. getQueryContext('user').name) → context_property_expr
      const lastSegment = segments[segments.length - 1].id;
      const ir = {kind: 'context_property_expr' as const, contextIri: contextId, property: lastSegment};
      return new ExpressionNode(ir);
    }
    // Context root reference (e.g. getQueryContext('user')) → reference_expr with the context IRI
    const ir = {kind: 'reference_expr' as const, value: contextId};
    return new ExpressionNode(ir);
  }

  const segments = FieldSet.collectPropertySegments(qbo);
  if (segments.length === 0) {
    // Root shape or entity reference — produce alias expression (the entity itself)
    return tracedAliasExpression([]);
  }
  const segmentIds = segments.map((s) => s.id);
  return tracedPropertyExpression(segmentIds);
}

/** Walk up the QueryBuilderObject chain to find a query context ID. */
function findContextId(qbo: QueryBuilderObject): string | undefined {
  let current: QueryBuilderObject | undefined = qbo;
  while (current) {
    if (current instanceof QueryShape && (current.originalValue as any)?.__queryContextId) {
      return (current.originalValue as any).__queryContextId;
    }
    current = current.subject as QueryBuilderObject | undefined;
  }
  return undefined;
}

/**
 * A wrapper for inline `.where()` on primitives that produces alias-based expressions.
 * When `p.hobby.where(h => h.equals('Jogging'))` is called, `h` should reference
 * the hobby variable itself (alias), not traverse to a sub-property.
 */
class InlineWhereProxy extends QueryBuilderObject {
  constructor(public readonly source: QueryPrimitive<any>) {
    super(source.property, source.subject);
  }

  equals(otherValue: any): ExpressionNode {
    // Empty traversal = "the current alias" — resolved by lowering
    // against the property's own alias scope
    const self = tracedAliasExpression([]);
    return self.eq(otherValue);
  }
}

/**
 * Wrap a QueryPrimitive in a Proxy that intercepts expression method calls.
 * When an expression method (e.g., `.plus()`, `.gt()`, `.equals()`) is accessed,
 * creates a traced ExpressionNode based on the QueryPrimitive's property path.
 */
function wrapWithExpressionProxy<T>(qp: QueryPrimitive<T>): QueryPrimitive<T> {
  return new Proxy(qp, {
    get(target, key, receiver) {
      if (typeof key === 'string' && EXPRESSION_METHODS.has(key)) {
        const segments = FieldSet.collectPropertySegments(target);
        // Only intercept if we have valid property segments to trace
        if (segments.length > 0) {
          const segmentIds = segments.map((s) => s.id);
          const baseNode = tracedPropertyExpression(segmentIds);
          return (...args: any[]) => {
            // Convert QueryBuilderObject arguments to ExpressionNode
            const convertedArgs = args.map((arg) =>
              arg instanceof QueryBuilderObject ? (toExpressionNode(arg) ?? arg) : arg,
            );
            return (baseNode as any)[key](...convertedArgs);
          };
        }
      }
      return Reflect.get(target, key, receiver);
    },
  }) as QueryPrimitive<T>;
}

/**
 * Evaluate a sort callback through the proxy and extract a SortByPath.
 * This is a standalone helper that replaces the need for the former SelectQueryFactory.sortBy().
 */
export const evaluateSortCallback = <S extends Shape>(
  shape: ShapeConstructor<S>,
  sortFn: (p: any) => any,
  direction: 'ASC' | 'DESC' = 'ASC',
): SortByPath => {
  const proxy = createProxiedPathBuilder(shape);
  const response = sortFn(proxy);
  const nodeShape = shape.shape;
  const paths: PropertyPath[] = [];
  if (response instanceof QueryBuilderObject || response instanceof QueryPrimitiveSet) {
    paths.push(new PropertyPath(nodeShape, FieldSet.collectPropertySegments(response)));
  } else if (Array.isArray(response)) {
    for (const item of response) {
      if (item instanceof QueryBuilderObject) {
        paths.push(new PropertyPath(nodeShape, FieldSet.collectPropertySegments(item)));
      }
    }
  }
  return {paths, direction};
};

export class QueryShapeSet<
  S extends Shape = Shape,
  Source = any,
  Property extends string | number | symbol = any,
> extends QueryBuilderObject<ShapeSet<S>, Source, Property> {
  public queryShapes: CoreSet<QueryShape>;
  private proxy;

  constructor(
    _originalValue?: ShapeSet<S>,
    property?: PropertyShape,
    subject?: QueryShape<any> | QueryShapeSet<any>,
  ) {
    super(property, subject);
    this.originalValue = _originalValue;

    //Note that QueryShapeSet intentionally does not store the _originalValue shape set, because it manipulates this.queryShapes
    // and then recreates the original shape set when getOriginalValue() is called
    this.queryShapes = new CoreSet(
      _originalValue?.map((shape) =>
        QueryShape.create(shape, property, subject),
      ),
    );
  }

  static create<S extends Shape = Shape>(
    originalValue: ShapeSet<S>,
    property: PropertyShape,
    subject: QueryShape<any> | QueryShapeSet<any>,
  ) {
    let instance = new QueryShapeSet<S>(originalValue, property, subject);

    let proxy = this.proxifyShapeSet<S>(instance);
    return proxy;
  }

  static proxifyShapeSet<T extends Shape = Shape>(
    queryShapeSet: QueryShapeSet<T>,
  ) {
    let originalShapeSet = queryShapeSet.getOriginalValue();

    queryShapeSet.proxy = new Proxy(queryShapeSet, {
      get(target, key, receiver) {
        //if the key is a string
        if (typeof key === 'string') {
          //if this is a get method that is implemented by the QueryShapeSet, then use that
          if (key in queryShapeSet) {
            //if it's a function, then bind it to the queryShape and return it so it can be called
            if (typeof queryShapeSet[key] === 'function') {
              return target[key].bind(target);
            }
            //if it's a get method, then return that
            //NOTE: we may not need this if we don't use any get methods in QueryValue classes?
            return queryShapeSet[key];
          }

          //if not, then a method/accessor was called that likely fits with the methods of the original SHAPE of the items in the shape set
          //As in Shape.friends.name -> key would be name, which is requested from (each item in!) a ShapeSet of Shapes
          //So here we find back the shape that all items have in common, and then find the property shape that matches the key
          //NOTE: this will only work if the key corresponds with an accessor in the shape that uses a @linkedProperty decorator
          let leastSpecificShape = queryShapeSet
            .getOriginalValue()
            .getLeastSpecificShape();
          let valueShape = leastSpecificShape ? leastSpecificShape.shape : null;
          if (!valueShape && queryShapeSet.property?.valueShape) {
            const shapeClass = getShapeClass(queryShapeSet.property.valueShape);
            valueShape = shapeClass?.shape;
          }
          let propertyShape: PropertyShape = valueShape
            ?.getPropertyShapes(true)
            .find((propertyShape) => propertyShape.label === key);

          //if the property shape is found
          if (propertyShape) {
            return queryShapeSet.callPropertyShapeAccessor(propertyShape);
          } else if (
            //else if a method of the original shape is called, like .forEach() or similar
            originalShapeSet[key] &&
            typeof originalShapeSet[key] === 'function'
          ) {
            //then return that method and bind the original value as 'this'
            return originalShapeSet[key].bind(originalShapeSet);
          } else if (key !== 'then' && key !== '$$typeof') {
            console.warn(
              'Could not find property shape for key ' +
                key +
                ' on shape ' +
                valueShape?.label +
                '. Make sure the get method exists and is decorated with @linkedProperty / @objectProperty / @literalProperty',
            );
          }
        }
        //otherwise return the value of the property on the original shape
        return originalShapeSet[key];
      },
    });
    return queryShapeSet.proxy;
  }

  as<ShapeClass extends typeof Shape>(
    shape: ShapeClass,
  ): QShapeSet<InstanceType<ShapeClass>, Source, Property> {
    //if the shape is not the same as the original value, then we need to create a new query shape
    if (!shape.shape.equals(this.originalValue.getLeastSpecificShape().shape)) {
      let newOriginal = new ShapeSet(
        this.originalValue.map((existing) => {
          const instance = new (shape as any)();
          if (existing?.id) {
            instance.id = existing.id;
          }
          return instance;
        }),
      );
      return QueryShapeSet.create(
        newOriginal,
        this.property,
        this.subject as any,
      );
    }
    // else return this
    return this as any as QShapeSet<InstanceType<ShapeClass>, Source, Property>;
  }

  add(item) {
    this.queryShapes.add(item);
  }

  concat(other: QueryShapeSet): QueryShapeSet {
    if (other) {
      if (other instanceof QueryShapeSet) {
        (other as QueryShapeSet).queryShapes.forEach(
          this.queryShapes.add.bind(this.queryShapes),
        );
      } else {
        throw new Error('Unknown type: ' + other);
      }
    }
    return this;
  }

  filter(filterFn): QueryShapeSet {
    let clone = new QueryShapeSet(
      new ShapeSet(),
      this.property,
      this.subject as QueryShape<any> | QueryShapeSet<any>,
    );
    clone.queryShapes = this.queryShapes.filter(filterFn);
    return clone;
  }

  setSource(val: boolean) {
    this.queryShapes.forEach((shape) => {
      shape.isSource = val;
    });
  }

  getOriginalValue() {
    return new ShapeSet(
      this.queryShapes.map((shape) => {
        return shape.originalValue;
      }),
    ) as ShapeSet<S>;
  }

  callPropertyShapeAccessor(
    propertyShape: PropertyShape,
  ): QueryShapeSet | QueryPrimitiveSet {
    //call the get method for that property shape on each item in the shape set
    //and return the result as a new shape set
    let result: QueryPrimitiveSet | QueryShapeSet; //QueryValueSetOfSets;

    //if we expect the accessor to return a Primitive (string,number,boolean,Date)
    if (isSameRef(propertyShape.nodeKind, shacl.Literal)) {
      //then return a Set of QueryPrimitives
      result = new QueryPrimitiveSet(null, propertyShape, this);
    } else {
      // result = QueryValueSetOfSets.create(propertyShape, this); //QueryShapeSet.create(null, propertyShape, this);
      result = QueryShapeSet.create(null, propertyShape, this);
    }
    let expectSingleValues =
      typeof propertyShape.maxCount === 'number' && propertyShape.maxCount <= 1;

    this.queryShapes.forEach((shape) => {
      //access the propertyShapes accessor,
      // since the shape should already be converted to a QueryShape, the result is a QueryValue also
      let shapeQueryValue = shape[propertyShape.label];

      //only add results if something was actually returned, if the property is not defined for this shape the result can be undefined
      if (shapeQueryValue) {
        if (expectSingleValues) {
          (result as any).add(shapeQueryValue);
        } else {
          //if each of the shapes in a set return a new shapeset for the request accessor
          //then we merge all the returned values into a single shapeset
          (result as QueryShapeSet).concat(shapeQueryValue);
        }
      }
    });
    return result;
  }

  //countable?, resultKey?: string
  size(): SetSize<this> {
    //when count() is called we want to count the number of items in the entire query path
    return new SetSize(this); //countable, resultKey
  }

  // get testItem() {}
  where(validation: WhereClause<S>): this {
    if (
      (this.getPropertyPath() as QueryStep[]).some(
        (step) => (step as PropertyQueryStep).where,
      )
    ) {
      throw new Error(
        'You cannot call where() from within a where() clause. Consider using some() or every() instead',
      );
    }
    let leastSpecificShape = this.getOriginalValue().getLeastSpecificShape();
    this.wherePath = processWhereClause(validation, leastSpecificShape);
    //return this.proxy because after Shape.friends.where() we can call other methods of Shape.friends
    //and for that we need the proxy
    return this.proxy;
  }

  select<QF = unknown>(
    subQueryFn: QueryBuildFn<S, QF>,
  ): FieldSet<QF, QueryShapeSet<S, Source, Property>> {
    const leastSpecificShape = this.getOriginalValue().getLeastSpecificShape();
    const parentSegments = FieldSet.collectPropertySegments(this);
    const fs = FieldSet.forSubSelect<QF, QueryShapeSet<S, Source, Property>>(
      leastSpecificShape,
      subQueryFn as any,
      parentSegments,
    );
    return fs;
  }

  selectAll(): FieldSet<
    SelectAllQueryResponse<S>,
    QueryShapeSet<S, Source, Property>
  > {
    let leastSpecificShape = this.getOriginalValue().getLeastSpecificShape();
    const propertyLabels = leastSpecificShape.shape
      .getUniquePropertyShapes()
      .map((propertyShape) => propertyShape.label);
    return this.select((shape) =>
      propertyLabels.map((label) => (shape as any)[label]),
    );
  }

  some(validation: WhereClause<S>): ExistsCondition {
    const predicate = this.buildPredicateExpression(validation);
    const pathSegmentIds = FieldSet.collectPropertySegments(this).map(s => s.id);
    return new ExistsCondition(pathSegmentIds, predicate, false);
  }

  every(validation: WhereClause<S>): ExistsCondition {
    // every(fn) = NOT EXISTS(path WHERE NOT(fn))
    const predicate = this.buildPredicateExpression(validation);
    const pathSegmentIds = FieldSet.collectPropertySegments(this).map(s => s.id);
    return new ExistsCondition(pathSegmentIds, predicate.not(), true);
  }

  none(validation: WhereClause<S>): ExistsCondition {
    // none(fn) = NOT EXISTS(path WHERE fn) = some(fn).not()
    const predicate = this.buildPredicateExpression(validation);
    const pathSegmentIds = FieldSet.collectPropertySegments(this).map(s => s.id);
    return new ExistsCondition(pathSegmentIds, predicate, true);
  }

  private buildPredicateExpression(validation: WhereClause<S>): ExpressionNode {
    const leastSpecificShape = this.getOriginalValue().getLeastSpecificShape();
    if (validation instanceof Function) {
      const proxy = createProxiedPathBuilder(leastSpecificShape) as any;
      const result = validation(proxy);
      if (isExpressionNode(result)) {
        return result;
      }
      throw new Error('Validation callback must return an ExpressionNode');
    }
    if (isExpressionNode(validation)) {
      return validation;
    }
    throw new Error('Expected a callback or ExpressionNode for some/every/none');
  }
}

export class QueryShape<
  S extends Shape = Shape,
  Source = any,
  Property extends string | number | symbol = any,
> extends QueryBuilderObject<S, Source, Property> {
  public isSource: boolean;
  private proxy;

  constructor(
    public originalValue: S,
    property?: PropertyShape,
    subject?: QueryShape<any> | QueryShapeSet<any>,
  ) {
    super(property, subject);
  }

  get id() {
    return (
      (this.originalValue as Shape).__queryContextId ||
      this.originalValue['id']
    );
  }

  static create(
    original: Shape,
    property?: PropertyShape,
    subject?: QueryShape<any> | QueryShapeSet<any>,
  ) {
    let instance = new QueryShape(original, property, subject);
    let proxy = this.proxifyQueryShape(instance);
    return proxy;
  }

  private static proxifyQueryShape<T extends Shape>(queryShape: QueryShape<T>) {
    let originalShape = queryShape.originalValue;
    queryShape.proxy = new Proxy(queryShape, {
      get(target, key, receiver) {
        //if the key is a string
        if (typeof key === 'string') {
          //if this is a get method that is implemented by the QueryShape, then use that
          if (key in queryShape) {
            //if it's a function, then bind it to the queryShape and return it so it can be called
            if (typeof queryShape[key] === 'function') {
              return target[key].bind(target);
            }
            //if it's a get method, then return that
            //NOTE: we may not need this if we don't use any get methods in QueryValue classes?
            return queryShape[key];
          }

          //if not, then a method/accessor of the original shape was called
          //then check if we have indexed any property shapes with that name for this shapes NodeShape
          //NOTE: this will only work with a @linkedProperty decorator
          let propertyShape = getPropertyShapeByLabel(
            originalShape.constructor as typeof Shape,
            key,
          );
          if (propertyShape) {
            return QueryBuilderObject.generatePathValue(propertyShape, target);
          }
        }
        if (key !== 'then' && key !== '$$typeof') {
          //   //otherwise return the value of the property on the original shape
          //generate stack trace for debugging
          let stack = new Error().stack;
          //https://stackoverflow.com/a/49725198/977206
          const stackLines = stack.split('\n').slice(1); //remove the "Error" line
          console.warn(
            `${originalShape.constructor.name}.${key.toString()} is accessed in a query, but it does not have a @linkedProperty decorator. Queries can only access decorated get/set methods. ${stackLines.join('\n')}`,
          );
        }
        return originalShape[key];
      },
    });
    return queryShape.proxy;
  }

  as<ShapeClass extends typeof Shape>(
    shape: ShapeClass,
  ): QShape<InstanceType<ShapeClass>, Source, Property> {
    //if the shape is not the same as the original value, then we need to create a new query shape
    if (!shape.shape.equals(this.originalValue.nodeShape)) {
      let newOriginal = new (shape as any)();
      if (this.originalValue.id) {
        newOriginal.id = this.originalValue.id;
      }
      return QueryShape.create(newOriginal, this.property, this.subject as any);
    }
    return this as any as QShape<InstanceType<ShapeClass>, Source, Property>;
  }

  equals(otherValue: NodeReferenceValue | QShape<any>): ExpressionNode {
    const self = toExpressionNode(this);
    const arg = otherValue instanceof QueryBuilderObject
      ? toExpressionNode(otherValue)
      : otherValue;
    return self.eq(arg as any);
  }

  select<QF = unknown>(
    subQueryFn: QueryBuildFn<S, QF>,
  ): FieldSet<QF, QueryShape<S, Source, Property>> {
    const leastSpecificShape = getShapeClass(
      (this.getOriginalValue() as Shape).nodeShape.id,
    );
    const parentSegments = FieldSet.collectPropertySegments(this);
    const fs = FieldSet.forSubSelect<QF, QueryShape<S, Source, Property>>(
      leastSpecificShape,
      subQueryFn as any,
      parentSegments,
    );
    return fs;
  }

  selectAll(): FieldSet<
    SelectAllQueryResponse<S>,
    QueryShape<S, Source, Property>
  > {
    let leastSpecificShape = getShapeClass(
      (this.getOriginalValue() as Shape).nodeShape.id,
    );
    const propertyLabels = leastSpecificShape.shape
      .getUniquePropertyShapes()
      .map((propertyShape) => propertyShape.label);
    return this.select((shape) =>
      propertyLabels.map((label) => (shape as any)[label]),
    );
  }

  // count(countable: QueryBuilderObject, resultKey?: string): SetSize<this> {
  //   return new SetSize(this, countable, resultKey);
  //   // return this._count;
  // }
}

export class Evaluation {
  private _andOr: AndOrQueryToken[] = [];

  constructor(
    public value: QueryBuilderObject | QueryPrimitiveSet,
    public method: WhereMethods,
    public args: QueryArg[],
  ) {}

  getPropertyPath() {
    return this.getWherePath();
  }

  processArgs(): QueryArg[] {
    //if the args are not an array, then we convert them to an array
    if (!this.args || !Array.isArray(this.args)) {
      return [];
    }
    //convert each arg to a QueryBuilderObject
    return this.args.map((arg) => {
      if (arg instanceof QueryBuilderObject) {
        let path = arg.getPropertyPath();
        let subject;
        if (path[0] && (path[0] as ShapeReferenceValue).id) {
          subject = path.shift();
        }
        if ((!path || path.length === 0) && subject) {
          return subject as ShapeReferenceValue;
        }
        return {
          path,
          subject,
        } as ArgPath;
      } else {
        return arg;
      }
    });
  }

  getWherePath(): WherePath {
    let evalPath: WhereEvaluationPath = {
      path: this.value.getPropertyPath(),
      method: this.method,
      args: this.processArgs(),
    };

    if (this._andOr.length > 0) {
      return {
        firstPath: evalPath,
        andOr: this._andOr,
      };
    }
    return evalPath;
  }

  and(subQuery: WhereClause<any>) {
    this._andOr.push({
      and: processWhereClause(subQuery),
    });
    return this;
  }

  or(subQuery: WhereClause<any>) {
    this._andOr.push({
      or: processWhereClause(subQuery),
    });
    return this;
  }
}

class SetEvaluation extends Evaluation {}

/**
 * Concrete query wrapper for JS primitive values (string, number, boolean, Date).
 *
 * Replaces the former abstract class + subclasses (QueryString, QueryNumber,
 * QueryBoolean, QueryDate) — the type parameter T carries the primitive type,
 * so separate subclasses are unnecessary.
 */
export class QueryPrimitive<
  T,
  Source = any,
  Property extends string | number | symbol = any,
> extends QueryBuilderObject<T, Source, Property> {
  constructor(
    public originalValue?: T,
    public property?: PropertyShape,
    public subject?: QueryShape<any> | QueryShapeSet<any> | QueryPrimitiveSet,
  ) {
    super(property, subject);
  }

  equals(otherValue: JSPrimitive | QueryBuilderObject): ExpressionNode {
    const self = toExpressionNode(this);
    const arg = otherValue instanceof QueryBuilderObject
      ? toExpressionNode(otherValue)
      : otherValue;
    return self.eq(arg as any);
  }

  where(validation: WhereClause<string>): this {
    // For inline where on a primitive (p.hobby.where(h => h.equals(...))),
    // pass a clone that produces alias expressions (the bound value itself)
    // rather than property traversals
    const selfAsAlias = new InlineWhereProxy(this);
    this.wherePath = processWhereClause(validation, selfAsAlias as any);
    //return this because after Shape.friends.where() we can call other methods of Shape.friends
    return this as any;
  }
}


export class QueryPrimitiveSet<
  QPrimitive extends QueryPrimitive<any> = null,
> extends QueryBuilderObject<any, any, any> {
  public contents: CoreSet<QPrimitive>;

  constructor(
    public originalValue?: JSNonNullPrimitive[],
    public property?: PropertyShape,
    public subject?: QueryShapeSet<any> | QueryShape<any>,
    items?,
  ) {
    super(property, subject);
    this.contents = new CoreSet(items);
  }

  add(item) {
    this.contents.add(item);
  }

  values() {
    return [...this.contents.values()];
  }

  //this is needed because we extend CoreSet which has a createNew method but does not expect the constructor to have arguments
  createNew(...args): this {
    return new (<any>this.constructor)(
      this.property,
      this.subject,
      ...args,
    ) as this;
  }

  //TODO: see if we can merge these methods of QueryPrimitive and QueryPrimitiveSet
  // so that they're only defined once
  equals(other): ExpressionNode {
    return toExpressionNode(this).eq(other);
  }

  getPropertyStep(): QueryStep {
    if (this.contents.size > 1) {
      throw new Error(
        'This should never happen? Not implemented: get property path for a QueryPrimitiveSet with multiple values',
      );
    }
    return this.contents.first().getPropertyStep();
  }

  getPropertyPath(): QueryPropertyPath {
    if (this.contents.size > 1) {
      throw new Error(
        'This should never happen? Not implemented: get property path for a QueryPrimitiveSet with multiple values',
      );
    }
    //here we let the first item in the set return its property path, because all items will be the same
    //however, sometimes the path goes through the subject of this SET rather than the individual items (which have an individual shape as subject)
    //so we pass the subject of this set so it can be used
    let first = this.contents.first();
    if (first) {
      (first.subject as QueryShapeSet).wherePath =
        (first.subject as QueryShapeSet).wherePath || this.subject.wherePath;
      return first.getPropertyPath();
    } else {
      console.warn(
        `QueryPrimitiveSet without items. From ${this.subject.getOriginalValue().nodeShape.label}.${this.property.label}.  What to return as property path?`,
      );
      return this.subject.getPropertyPath();
    }
  }

  //countable, resultKey?: string
  size(): SetSize<this> {
    return new SetSize(this as QueryPrimitiveSet);
    //countable, resultKey
  }
}

export class SetSize<Source = null> extends QueryPrimitive<number, Source> {
  constructor(
    public subject: QueryShapeSet | QueryShape | QueryPrimitiveSet,
    public countable?: QueryBuilderObject,
    public label?: string,
  ) {
    super();
  }

  // Build an aggregate_expr(count, ...) ExpressionNode for the counted property
  equals(otherValue: any): ExpressionNode {
    const countedSegments = FieldSet.collectPropertySegments(this.subject);
    const countedIds = countedSegments.map(s => s.id);
    const countedNode = tracedPropertyExpression(countedIds);
    // Wrap in aggregate_expr(count)
    const countExpr = new ExpressionNode({
      kind: 'aggregate_expr',
      name: 'count',
      args: [countedNode.ir],
    } as any, countedNode._refs);
    return countExpr.eq(otherValue);
  }

  as(label: string) {
    this.label = label;
    return this;
  }

  getPropertyPath(): QueryPropertyPath {
    //count the last property in the path
    //use the label of the last property as the label of the count step
    let countable = this.subject.getPropertyStep();
    let self: SizeStep = {
      count: [countable],
      label: this.label || this.subject.property.label,
    };

    //request the path of the subject's subject (the parent of the parent)
    //and add the SizeStep to that path, since we already used the subject as the thing that's counted
    if (this.subject.subject) {
      let path = this.subject.subject.getPropertyPath();
      path.push(self);
      return path;
    }
    return [self];
  }
}

