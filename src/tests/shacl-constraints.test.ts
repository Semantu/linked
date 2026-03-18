import {createPropertyShape} from '../shapes/SHACL';
import type {LiteralPropertyShapeConfig, ObjectPropertyShapeConfig} from '../shapes/SHACL';

const EX_NS = 'http://example.org/';

// ---------------------------------------------------------------------------
// hasValue — literal values
// ---------------------------------------------------------------------------

describe('hasValue constraint', () => {
  it('stores a literal string as-is (not wrapped as {id})', () => {
    const ps = createPropertyShape(
      {path: {id: `${EX_NS}status`}, hasValue: 'active'} as LiteralPropertyShapeConfig,
      'status',
    );
    expect(ps.hasValueConstraint).toBe('active');
  });

  it('stores a number as-is', () => {
    const ps = createPropertyShape(
      {path: {id: `${EX_NS}priority`}, hasValue: 42} as LiteralPropertyShapeConfig,
      'priority',
    );
    expect(ps.hasValueConstraint).toBe(42);
  });

  it('stores a boolean as-is', () => {
    const ps = createPropertyShape(
      {path: {id: `${EX_NS}active`}, hasValue: true} as LiteralPropertyShapeConfig,
      'active',
    );
    expect(ps.hasValueConstraint).toBe(true);
  });

  it('stores false correctly (falsy literal)', () => {
    const ps = createPropertyShape(
      {path: {id: `${EX_NS}active`}, hasValue: false} as LiteralPropertyShapeConfig,
      'active',
    );
    expect(ps.hasValueConstraint).toBe(false);
  });

  it('stores 0 correctly (falsy literal)', () => {
    const ps = createPropertyShape(
      {path: {id: `${EX_NS}count`}, hasValue: 0} as LiteralPropertyShapeConfig,
      'count',
    );
    expect(ps.hasValueConstraint).toBe(0);
  });

  it('stores empty string correctly (falsy literal)', () => {
    const ps = createPropertyShape(
      {path: {id: `${EX_NS}label`}, hasValue: ''} as LiteralPropertyShapeConfig,
      'label',
    );
    expect(ps.hasValueConstraint).toBe('');
  });

  it('stores an IRI node reference via {id}', () => {
    const ps = createPropertyShape(
      {path: {id: `${EX_NS}type`}, hasValue: {id: `${EX_NS}Person`}} as LiteralPropertyShapeConfig,
      'type',
    );
    expect(ps.hasValueConstraint).toEqual({id: `${EX_NS}Person`});
  });

  it('exposes hasValue through getResult()', () => {
    const ps = createPropertyShape(
      {path: {id: `${EX_NS}status`}, hasValue: 'active'} as LiteralPropertyShapeConfig,
      'status',
    );
    const result = ps.getResult() as any;
    expect(result.hasValue).toBe('active');
  });

  it('exposes falsy hasValue through getResult()', () => {
    const ps = createPropertyShape(
      {path: {id: `${EX_NS}flag`}, hasValue: false} as LiteralPropertyShapeConfig,
      'flag',
    );
    const result = ps.getResult() as any;
    expect(result.hasValue).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// in — literal and IRI values
// ---------------------------------------------------------------------------

describe('in constraint', () => {
  it('stores literal strings as-is', () => {
    const ps = createPropertyShape(
      {path: {id: `${EX_NS}status`}, in: ['ACTIVE', 'PENDING', 'CLOSED']} as LiteralPropertyShapeConfig,
      'status',
    );
    expect(ps.in).toEqual(['ACTIVE', 'PENDING', 'CLOSED']);
  });

  it('stores IRI node references via {id}', () => {
    const ps = createPropertyShape(
      {
        path: {id: `${EX_NS}type`},
        in: [{id: `${EX_NS}TypeA`}, {id: `${EX_NS}TypeB`}],
      } as LiteralPropertyShapeConfig,
      'type',
    );
    expect(ps.in).toEqual([{id: `${EX_NS}TypeA`}, {id: `${EX_NS}TypeB`}]);
  });

  it('stores mixed IRIs and literals', () => {
    const ps = createPropertyShape(
      {
        path: {id: `${EX_NS}value`},
        in: [{id: `${EX_NS}Foo`}, 'bar', 42],
      } as LiteralPropertyShapeConfig,
      'value',
    );
    expect(ps.in).toEqual([{id: `${EX_NS}Foo`}, 'bar', 42]);
  });

  it('stores numbers', () => {
    const ps = createPropertyShape(
      {path: {id: `${EX_NS}rating`}, in: [1, 2, 3, 4, 5]} as LiteralPropertyShapeConfig,
      'rating',
    );
    expect(ps.in).toEqual([1, 2, 3, 4, 5]);
  });

  it('stores booleans', () => {
    const ps = createPropertyShape(
      {path: {id: `${EX_NS}flag`}, in: [true, false]} as LiteralPropertyShapeConfig,
      'flag',
    );
    expect(ps.in).toEqual([true, false]);
  });

  it('exposes in through getResult()', () => {
    const ps = createPropertyShape(
      {path: {id: `${EX_NS}status`}, in: ['ACTIVE', 'PENDING']} as LiteralPropertyShapeConfig,
      'status',
    );
    const result = ps.getResult() as any;
    expect(result.in).toEqual(['ACTIVE', 'PENDING']);
  });
});

// ---------------------------------------------------------------------------
// lessThan and lessThanOrEquals — wired up
// ---------------------------------------------------------------------------

describe('lessThan constraint', () => {
  it('stores lessThan property reference', () => {
    const ps = createPropertyShape(
      {
        path: {id: `${EX_NS}startDate`},
        lessThan: {id: `${EX_NS}endDate`},
      } as LiteralPropertyShapeConfig,
      'startDate',
    );
    expect(ps.lessThan).toEqual({id: `${EX_NS}endDate`});
  });

  it('exposes lessThan through getResult()', () => {
    const ps = createPropertyShape(
      {
        path: {id: `${EX_NS}startDate`},
        lessThan: {id: `${EX_NS}endDate`},
      } as LiteralPropertyShapeConfig,
      'startDate',
    );
    const result = ps.getResult() as any;
    expect(result.lessThan).toEqual({id: `${EX_NS}endDate`});
  });
});

describe('lessThanOrEquals constraint', () => {
  it('stores lessThanOrEquals property reference', () => {
    const ps = createPropertyShape(
      {
        path: {id: `${EX_NS}minPrice`},
        lessThanOrEquals: {id: `${EX_NS}maxPrice`},
      } as LiteralPropertyShapeConfig,
      'minPrice',
    );
    expect(ps.lessThanOrEquals).toEqual({id: `${EX_NS}maxPrice`});
  });

  it('exposes lessThanOrEquals through getResult()', () => {
    const ps = createPropertyShape(
      {
        path: {id: `${EX_NS}minPrice`},
        lessThanOrEquals: {id: `${EX_NS}maxPrice`},
      } as LiteralPropertyShapeConfig,
      'minPrice',
    );
    const result = ps.getResult() as any;
    expect(result.lessThanOrEquals).toEqual({id: `${EX_NS}maxPrice`});
  });
});

// ---------------------------------------------------------------------------
// equals and disjoint — always IRI, no change but verify
// ---------------------------------------------------------------------------

describe('equals constraint', () => {
  it('stores property IRI reference', () => {
    const ps = createPropertyShape(
      {
        path: {id: `${EX_NS}name`},
        equals: {id: `${EX_NS}givenName`},
      } as LiteralPropertyShapeConfig,
      'name',
    );
    expect(ps.equalsConstraint).toEqual({id: `${EX_NS}givenName`});
  });
});

describe('disjoint constraint', () => {
  it('stores property IRI reference', () => {
    const ps = createPropertyShape(
      {
        path: {id: `${EX_NS}name`},
        disjoint: {id: `${EX_NS}familyName`},
      } as LiteralPropertyShapeConfig,
      'name',
    );
    expect(ps.disjoint).toEqual({id: `${EX_NS}familyName`});
  });
});
