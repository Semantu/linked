import {Shape, ShapeType} from '../shapes/Shape.js';
import {getShapeClass} from '../utils/ShapeClass.js';

/**
 * Resolve a shape class or IRI string to a ShapeType.
 *
 * Shared utility used by QueryBuilder, CreateBuilder, UpdateBuilder, and DeleteBuilder
 * to normalize their shape input.
 *
 * @throws If a string IRI cannot be resolved via the shape registry.
 */
export function resolveShape<S extends Shape>(
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
