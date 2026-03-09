import {Shape, ShapeType} from '../shapes/Shape.js';
import {getShapeClass} from '../utils/ShapeClass.js';
import {UpdatePartial, NodeReferenceValue} from './QueryFactory.js';
import {CreateQueryFactory, CreateQuery, CreateResponse} from './CreateQuery.js';
import {getQueryDispatch} from './queryDispatch.js';

/**
 * Internal state bag for CreateBuilder.
 */
interface CreateBuilderInit<S extends Shape> {
  shape: ShapeType<S>;
  data?: UpdatePartial<S>;
  fixedId?: string;
}

/**
 * An immutable, fluent builder for create mutations.
 *
 * Every mutation method returns a new CreateBuilder — the original is never modified.
 *
 * Implements PromiseLike so mutations execute on `await`:
 * ```ts
 * const result = await CreateBuilder.from(Person).set({name: 'Alice'});
 * ```
 *
 * Internally delegates to CreateQueryFactory for IR generation.
 */
export class CreateBuilder<S extends Shape = Shape, U extends UpdatePartial<S> = UpdatePartial<S>>
  implements PromiseLike<CreateResponse<U>>, Promise<CreateResponse<U>>
{
  private readonly _shape: ShapeType<S>;
  private readonly _data?: UpdatePartial<S>;
  private readonly _fixedId?: string;

  private constructor(init: CreateBuilderInit<S>) {
    this._shape = init.shape;
    this._data = init.data;
    this._fixedId = init.fixedId;
  }

  private clone(overrides: Partial<CreateBuilderInit<S>> = {}): CreateBuilder<S, any> {
    return new CreateBuilder<S, any>({
      shape: this._shape,
      data: this._data,
      fixedId: this._fixedId,
      ...overrides,
    });
  }

  // ---------------------------------------------------------------------------
  // Static constructors
  // ---------------------------------------------------------------------------

  /**
   * Create a CreateBuilder for the given shape.
   */
  static from<S extends Shape>(shape: ShapeType<S> | string): CreateBuilder<S> {
    const resolved = CreateBuilder.resolveShape<S>(shape);
    return new CreateBuilder<S>({shape: resolved});
  }

  private static resolveShape<S extends Shape>(
    shape: ShapeType<S> | string,
  ): ShapeType<S> {
    if (typeof shape === 'string') {
      const shapeClass = getShapeClass(shape);
      if (!shapeClass) {
        throw new Error(`Cannot resolve shape for '${shape}'`);
      }
      return shapeClass as unknown as ShapeType<S>;
    }
    return shape;
  }

  // ---------------------------------------------------------------------------
  // Fluent API
  // ---------------------------------------------------------------------------

  /** Set the data for the entity to create. */
  set<NewU extends UpdatePartial<S>>(data: NewU): CreateBuilder<S, NewU> {
    return this.clone({data}) as unknown as CreateBuilder<S, NewU>;
  }

  /** Pre-assign a node ID for the created entity. */
  withId(id: string): CreateBuilder<S, U> {
    return this.clone({fixedId: id}) as unknown as CreateBuilder<S, U>;
  }

  // ---------------------------------------------------------------------------
  // Build & execute
  // ---------------------------------------------------------------------------

  /** Build the IR mutation. */
  build(): CreateQuery {
    const data = this._data || {};

    // Validate that required properties (minCount >= 1) are present in data
    const shapeObj = (this._shape as any).shape;
    if (shapeObj) {
      const requiredProps = shapeObj
        .getUniquePropertyShapes()
        .filter((ps: any) => ps.minCount && ps.minCount >= 1);
      const dataKeys = new Set(Object.keys(data));
      const missing = requiredProps
        .filter((ps: any) => !dataKeys.has(ps.label))
        .map((ps: any) => ps.label);
      if (missing.length > 0) {
        throw new Error(
          `Missing required fields for '${shapeObj.label || shapeObj.id}': ${missing.join(', ')}`,
        );
      }
    }
    // TODO: Full data validation against the shape (type checking, maxCount, nested shapes, etc.)

    // Inject __id if fixedId is set
    const dataWithId = this._fixedId
      ? {...(data as any), __id: this._fixedId}
      : data;
    const factory = new CreateQueryFactory<S, UpdatePartial<S>>(
      this._shape as any as typeof Shape,
      dataWithId as UpdatePartial<S>,
    );
    return factory.build();
  }

  /** Execute the mutation. */
  exec(): Promise<CreateResponse<U>> {
    return getQueryDispatch().createQuery(this.build()) as Promise<CreateResponse<U>>;
  }

  // ---------------------------------------------------------------------------
  // Promise interface
  // ---------------------------------------------------------------------------

  then<TResult1 = CreateResponse<U>, TResult2 = never>(
    onfulfilled?: ((value: CreateResponse<U>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null,
  ): Promise<CreateResponse<U> | TResult> {
    return this.exec().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<CreateResponse<U>> {
    return this.exec().finally(onfinally);
  }

  get [Symbol.toStringTag](): string {
    return 'CreateBuilder';
  }
}
