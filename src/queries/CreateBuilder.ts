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
export class CreateBuilder<S extends Shape = Shape>
  implements PromiseLike<any>, Promise<any>
{
  private readonly _shape: ShapeType<S>;
  private readonly _data?: UpdatePartial<S>;
  private readonly _fixedId?: string;

  private constructor(init: CreateBuilderInit<S>) {
    this._shape = init.shape;
    this._data = init.data;
    this._fixedId = init.fixedId;
  }

  private clone(overrides: Partial<CreateBuilderInit<S>> = {}): CreateBuilder<S> {
    return new CreateBuilder<S>({
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
  set(data: UpdatePartial<S>): CreateBuilder<S> {
    return this.clone({data});
  }

  /** Pre-assign a node ID for the created entity. */
  withId(id: string): CreateBuilder<S> {
    return this.clone({fixedId: id});
  }

  // ---------------------------------------------------------------------------
  // Build & execute
  // ---------------------------------------------------------------------------

  /** Build the IR mutation. */
  build(): CreateQuery {
    const data = this._data || {};
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
  exec(): Promise<any> {
    return getQueryDispatch().createQuery(this.build());
  }

  // ---------------------------------------------------------------------------
  // Promise interface
  // ---------------------------------------------------------------------------

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null,
  ): Promise<any | TResult> {
    return this.exec().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<any> {
    return this.exec().finally(onfinally);
  }

  get [Symbol.toStringTag](): string {
    return 'CreateBuilder';
  }
}
