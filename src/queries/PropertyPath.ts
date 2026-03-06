import type {PropertyShape, NodeShape} from '../shapes/SHACL.js';

/**
 * A value object representing a sequence of property traversals from a root shape.
 *
 * Each segment is a PropertyShape representing one hop in the traversal.
 * For example, `friends.name` on PersonShape produces a PropertyPath with
 * two segments: [friendsPropertyShape, namePropertyShape].
 *
 * This is used by FieldSet and QueryBuilder to describe which properties
 * to select/filter, independent of proxy tracing.
 */
export class PropertyPath {
  constructor(
    readonly rootShape: NodeShape,
    readonly segments: PropertyShape[],
  ) {}

  /** Append a property traversal hop, returning a new PropertyPath. */
  prop(property: PropertyShape): PropertyPath {
    return new PropertyPath(this.rootShape, [...this.segments, property]);
  }

  /** The terminal (leaf) property of this path. */
  get terminal(): PropertyShape | undefined {
    return this.segments[this.segments.length - 1];
  }

  /** The depth (number of hops) of this path. */
  get depth(): number {
    return this.segments.length;
  }

  /** String representation using property labels joined by dots. */
  toString(): string {
    return this.segments.map((s) => s.label).join('.');
  }

  /** Two PropertyPaths are equal if they have the same root shape and same segment sequence. */
  equals(other: PropertyPath): boolean {
    if (this.rootShape.id !== other.rootShape.id) return false;
    if (this.segments.length !== other.segments.length) return false;
    return this.segments.every((s, i) => s.id === other.segments[i].id);
  }
}
