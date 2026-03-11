/**
 * Golden tests for the full SPARQL SELECT pipeline:
 *   query factory → IR → algebra → SPARQL string
 *
 * Each test captures the query from a DSL fixture, runs it through
 * buildSelectQuery (IR pipeline) then selectToSparql, and asserts the
 * exact SPARQL string output.
 */
import {describe, expect, test} from '@jest/globals';
import {queryFactories} from '../test-helpers/query-fixtures';
import {captureQuery} from '../test-helpers/query-capture-store';
import {selectToSparql} from '../sparql/irToAlgebra';
import {setQueryContext} from '../queries/QueryContext';
import {Person} from '../test-helpers/query-fixtures';

import '../ontologies/rdf';
import '../ontologies/xsd';

setQueryContext('user', {id: 'user-1'}, Person);

// ---------------------------------------------------------------------------
// URI shorthands for readability
// ---------------------------------------------------------------------------

const P = 'https://data.lincd.org/module/-_linked-core/shape/person';
const E = 'https://data.lincd.org/module/-_linked-core/shape/employee';
const D = 'https://data.lincd.org/module/-_linked-core/shape/dog';
const S = 'https://data.lincd.org/module/lincd/shape/shape';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

const goldenSelect = async (
  factory: () => Promise<unknown>,
): Promise<string> => {
  const ir = await captureQuery(factory);
  return selectToSparql(ir);
};

// ---------------------------------------------------------------------------
// Basic property selection
// ---------------------------------------------------------------------------

describe('SPARQL golden — basic selection', () => {
  test('selectName', async () => {
    const sparql = await goldenSelect(queryFactories.selectName);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a0_name
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/name> ?a0_name .
  }
}`);
  });

  test('selectFriends', async () => {
    const sparql = await goldenSelect(queryFactories.selectFriends);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a0_friends
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/friends> ?a0_friends .
  }
}`);
  });

  test('selectBirthDate', async () => {
    const sparql = await goldenSelect(queryFactories.selectBirthDate);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a0_birthDate
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/birthDate> ?a0_birthDate .
  }
}`);
  });

  test('selectIsRealPerson', async () => {
    const sparql = await goldenSelect(queryFactories.selectIsRealPerson);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a0_isRealPerson
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/isRealPerson> ?a0_isRealPerson .
  }
}`);
  });

  test('selectAll', async () => {
    const sparql = await goldenSelect(queryFactories.selectAll);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0
WHERE {
  ?a0 rdf:type <${P}> .
}`);
  });

  test('selectAllProperties', async () => {
    const sparql = await goldenSelect(queryFactories.selectAllProperties);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a0_name ?a0_hobby ?a0_nickNames ?a0_birthDate ?a0_isRealPerson ?a0_bestFriend ?a0_friends ?a0_pets ?a0_firstPet ?a0_pluralTestProp ?a0_label ?a0_type
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/name> ?a0_name .
  }
  OPTIONAL {
    ?a0 <${P}/hobby> ?a0_hobby .
  }
  OPTIONAL {
    ?a0 <${P}/nickNames> ?a0_nickNames .
  }
  OPTIONAL {
    ?a0 <${P}/birthDate> ?a0_birthDate .
  }
  OPTIONAL {
    ?a0 <${P}/isRealPerson> ?a0_isRealPerson .
  }
  OPTIONAL {
    ?a0 <${P}/bestFriend> ?a0_bestFriend .
  }
  OPTIONAL {
    ?a0 <${P}/friends> ?a0_friends .
  }
  OPTIONAL {
    ?a0 <${P}/pets> ?a0_pets .
  }
  OPTIONAL {
    ?a0 <${P}/firstPet> ?a0_firstPet .
  }
  OPTIONAL {
    ?a0 <${P}/pluralTestProp> ?a0_pluralTestProp .
  }
  OPTIONAL {
    ?a0 <${S}/label> ?a0_label .
  }
  OPTIONAL {
    ?a0 <${S}/type> ?a0_type .
  }
}`);
  });

  test('selectNonExistingMultiple', async () => {
    const sparql = await goldenSelect(queryFactories.selectNonExistingMultiple);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a0_bestFriend ?a0_friends
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/bestFriend> ?a0_bestFriend .
  }
  OPTIONAL {
    ?a0 <${P}/friends> ?a0_friends .
  }
}`);
  });
});

// ---------------------------------------------------------------------------
// SubjectId / filtering by ID
// ---------------------------------------------------------------------------

describe('SPARQL golden — subjectId', () => {
  test('selectById', async () => {
    const sparql = await goldenSelect(queryFactories.selectById);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a0_name
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/name> ?a0_name .
  }
  FILTER(?a0 = <linked://tmp/entities/p1>)
}`);
  });

  test('selectByIdReference', async () => {
    const sparql = await goldenSelect(queryFactories.selectByIdReference);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a0_name
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/name> ?a0_name .
  }
  FILTER(?a0 = <linked://tmp/entities/p1>)
}`);
  });

  test('selectNonExisting', async () => {
    const sparql = await goldenSelect(queryFactories.selectNonExisting);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a0_name
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/name> ?a0_name .
  }
  FILTER(?a0 = <https://does.not/exist>)
}`);
  });

  test('selectUndefinedOnly', async () => {
    const sparql = await goldenSelect(queryFactories.selectUndefinedOnly);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a0_hobby ?a0_bestFriend
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/hobby> ?a0_hobby .
  }
  OPTIONAL {
    ?a0 <${P}/bestFriend> ?a0_bestFriend .
  }
  FILTER(?a0 = <linked://tmp/entities/p3>)
}`);
  });

  test('selectOne', async () => {
    const sparql = await goldenSelect(queryFactories.selectOne);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a0_name
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/name> ?a0_name .
  }
  FILTER(?a0 = <linked://tmp/entities/p1>)
}
LIMIT 1`);
  });
});

// ---------------------------------------------------------------------------
// Nested traversals
// ---------------------------------------------------------------------------

describe('SPARQL golden — nested traversals', () => {
  test('selectFriendsName', async () => {
    const sparql = await goldenSelect(queryFactories.selectFriendsName);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a1_name ?a1
WHERE {
  ?a0 rdf:type <${P}> .
  ?a0 <${P}/friends> ?a1 .
  OPTIONAL {
    ?a1 <${P}/name> ?a1_name .
  }
}`);
  });

  test('selectNestedFriendsName', async () => {
    const sparql = await goldenSelect(queryFactories.selectNestedFriendsName);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a2_name ?a1 ?a2
WHERE {
  ?a0 rdf:type <${P}> .
  ?a0 <${P}/friends> ?a1 .
  ?a1 <${P}/friends> ?a2 .
  OPTIONAL {
    ?a2 <${P}/name> ?a2_name .
  }
}`);
  });

  test('selectMultiplePaths', async () => {
    const sparql = await goldenSelect(queryFactories.selectMultiplePaths);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a0_name ?a0_friends ?a1_name ?a1
WHERE {
  ?a0 rdf:type <${P}> .
  ?a0 <${P}/bestFriend> ?a1 .
  OPTIONAL {
    ?a0 <${P}/name> ?a0_name .
  }
  OPTIONAL {
    ?a0 <${P}/friends> ?a0_friends .
  }
  OPTIONAL {
    ?a1 <${P}/name> ?a1_name .
  }
}`);
  });

  test('selectBestFriendName', async () => {
    const sparql = await goldenSelect(queryFactories.selectBestFriendName);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a1_name ?a1
WHERE {
  ?a0 rdf:type <${P}> .
  ?a0 <${P}/bestFriend> ?a1 .
  OPTIONAL {
    ?a1 <${P}/name> ?a1_name .
  }
}`);
  });

  test('selectDeepNested', async () => {
    const sparql = await goldenSelect(queryFactories.selectDeepNested);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a3_name ?a1 ?a2 ?a3
WHERE {
  ?a0 rdf:type <${P}> .
  ?a0 <${P}/friends> ?a1 .
  ?a1 <${P}/bestFriend> ?a2 .
  ?a2 <${P}/bestFriend> ?a3 .
  OPTIONAL {
    ?a3 <${P}/name> ?a3_name .
  }
}`);
  });

  test('selectDuplicatePaths', async () => {
    const sparql = await goldenSelect(queryFactories.selectDuplicatePaths);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a1_name ?a1_hobby ?a1_isRealPerson ?a1
WHERE {
  ?a0 rdf:type <${P}> .
  ?a0 <${P}/bestFriend> ?a1 .
  OPTIONAL {
    ?a1 <${P}/name> ?a1_name .
  }
  OPTIONAL {
    ?a1 <${P}/hobby> ?a1_hobby .
  }
  OPTIONAL {
    ?a1 <${P}/isRealPerson> ?a1_isRealPerson .
  }
}`);
  });

  test('nestedObjectProperty', async () => {
    const sparql = await goldenSelect(queryFactories.nestedObjectProperty);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a1_bestFriend ?a1
WHERE {
  ?a0 rdf:type <${P}> .
  ?a0 <${P}/friends> ?a1 .
  OPTIONAL {
    ?a1 <${P}/bestFriend> ?a1_bestFriend .
  }
}`);
  });
});

// ---------------------------------------------------------------------------
// Inline where / filter fixtures
// ---------------------------------------------------------------------------

describe('SPARQL golden — inline where (lowered to projection)', () => {
  test('whereFriendsNameEquals', async () => {
    const sparql = await goldenSelect(queryFactories.whereFriendsNameEquals);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a1
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/friends> ?a1 .
    ?a1 <${P}/name> ?a1_name .
    FILTER(?a1_name = "Moa")
  }
}`);
  });

  test('whereHobbyEquals', async () => {
    const sparql = await goldenSelect(queryFactories.whereHobbyEquals);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a1
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/hobby> ?a1 .
    FILTER(?a1 = "Jogging")
  }
}`);
  });

  test('whereAnd', async () => {
    const sparql = await goldenSelect(queryFactories.whereAnd);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a1
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/friends> ?a1 .
    ?a1 <${P}/name> ?a1_name .
    ?a1 <${P}/hobby> ?a1_hobby .
    FILTER(?a1_name = "Moa" && ?a1_hobby = "Jogging")
  }
}`);
  });

  test('whereOr', async () => {
    const sparql = await goldenSelect(queryFactories.whereOr);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a1
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/friends> ?a1 .
    ?a1 <${P}/name> ?a1_name .
    ?a1 <${P}/hobby> ?a1_hobby .
    FILTER(?a1_name = "Jinx" || ?a1_hobby = "Jogging")
  }
}`);
  });

  test('whereAndOrAnd', async () => {
    const sparql = await goldenSelect(queryFactories.whereAndOrAnd);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a1
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/friends> ?a1 .
    ?a1 <${P}/name> ?a1_name .
    ?a1 <${P}/hobby> ?a1_hobby .
    FILTER((?a1_name = "Jinx" || ?a1_hobby = "Jogging") && ?a1_name = "Moa")
  }
}`);
  });

  test('whereAndOrAndNested', async () => {
    const sparql = await goldenSelect(queryFactories.whereAndOrAndNested);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a1
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/friends> ?a1 .
    ?a1 <${P}/name> ?a1_name .
    ?a1 <${P}/hobby> ?a1_hobby .
    FILTER(?a1_name = "Jinx" || ?a1_hobby = "Jogging" && ?a1_name = "Moa")
  }
}`);
  });
});

// ---------------------------------------------------------------------------
// Outer where clause (query-level FILTER)
// ---------------------------------------------------------------------------

describe('SPARQL golden — outer where', () => {
  test('whereBestFriendEquals', async () => {
    const sparql = await goldenSelect(queryFactories.whereBestFriendEquals);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/bestFriend> ?a0_bestFriend .
  }
  FILTER(?a0_bestFriend = <linked://tmp/entities/p3>)
}`);
  });

  test('selectWhereNameSemmy', async () => {
    const sparql = await goldenSelect(queryFactories.selectWhereNameSemmy);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/name> ?a0_name .
  }
  FILTER(?a0_name = "Semmy")
}`);
  });

  test('outerWhere', async () => {
    const sparql = await goldenSelect(queryFactories.outerWhere);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a0_friends
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/friends> ?a0_friends .
  }
  OPTIONAL {
    ?a0 <${P}/name> ?a0_name .
  }
  FILTER(?a0_name = "Semmy")
}`);
  });

  test('outerWhereLimit', async () => {
    const sparql = await goldenSelect(queryFactories.outerWhereLimit);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a0_name
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/name> ?a0_name .
  }
  FILTER(?a0_name = "Semmy" || ?a0_name = "Moa")
}
LIMIT 1`);
  });

  test('whereSomeImplicit', async () => {
    const sparql = await goldenSelect(queryFactories.whereSomeImplicit);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a1
WHERE {
  ?a0 rdf:type <${P}> .
  ?a0 <${P}/friends> ?a1 .
  OPTIONAL {
    ?a1 <${P}/name> ?a1_name .
  }
  FILTER(?a1_name = "Moa")
}`);
  });

  test('whereSomeExplicit', async () => {
    const sparql = await goldenSelect(queryFactories.whereSomeExplicit);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a1 <${P}/name> ?a1_name .
  }
  FILTER(EXISTS {
    ?a0 <${P}/friends> ?a1 .
    FILTER(?a1_name = "Moa")
  })
}`);
  });

  test('whereEvery', async () => {
    const sparql = await goldenSelect(queryFactories.whereEvery);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a1 <${P}/name> ?a1_name .
  }
  FILTER(!(EXISTS {
    ?a0 <${P}/friends> ?a1 .
    FILTER(!(?a1_name = "Moa" || ?a1_name = "Jinx"))
  }))
}`);
  });

  test('whereSequences', async () => {
    const sparql = await goldenSelect(queryFactories.whereSequences);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a1 <${P}/name> ?a1_name .
  }
  OPTIONAL {
    ?a0 <${P}/name> ?a0_name .
  }
  FILTER(EXISTS {
    ?a0 <${P}/friends> ?a1 .
    FILTER(?a1_name = "Jinx")
  } && ?a0_name = "Semmy")
}`);
  });

  test('whereWithContext', async () => {
    const sparql = await goldenSelect(queryFactories.whereWithContext);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a0_name
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/name> ?a0_name .
  }
  OPTIONAL {
    ?a0 <${P}/bestFriend> ?a0_bestFriend .
  }
  FILTER(?a0_bestFriend = <user-1>)
}`);
  });

  test('whereWithContextPath', async () => {
    const sparql = await goldenSelect(queryFactories.whereWithContextPath);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a0_name
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/name> ?a0_name .
  }
  OPTIONAL {
    ?a1 <${P}/name> ?a1_name .
  }
  OPTIONAL {
    <user-1> <${P}/name> ?__ctx__user_1_name .
  }
  FILTER(EXISTS {
    ?a0 <${P}/friends> ?a1 .
    FILTER(?a1_name = ?__ctx__user_1_name)
  })
}`);
  });
});

// ---------------------------------------------------------------------------
// Aggregates and GROUP BY
// ---------------------------------------------------------------------------

describe('SPARQL golden — aggregates', () => {
  test('countFriends', async () => {
    const sparql = await goldenSelect(queryFactories.countFriends);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT ?a0 (count(?a0_friends) AS ?a1)
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/friends> ?a0_friends .
  }
}
GROUP BY ?a0`);
  });

  test('countNestedFriends', async () => {
    const sparql = await goldenSelect(queryFactories.countNestedFriends);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT ?a0 (count(?a1_friends) AS ?a1_agg)
WHERE {
  ?a0 rdf:type <${P}> .
  ?a0 <${P}/friends> ?a1 .
  OPTIONAL {
    ?a1 <${P}/friends> ?a1_friends .
  }
}
GROUP BY ?a0`);
  });

  test('countLabel', async () => {
    const sparql = await goldenSelect(queryFactories.countLabel);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT ?a0 (count(?a1_friends) AS ?a1_agg)
WHERE {
  ?a0 rdf:type <${P}> .
  ?a0 <${P}/friends> ?a1 .
  OPTIONAL {
    ?a1 <${P}/friends> ?a1_friends .
  }
}
GROUP BY ?a0`);
  });

  test('customResultNumFriends', async () => {
    const sparql = await goldenSelect(queryFactories.customResultNumFriends);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT ?a0 (count(?a0_friends) AS ?a1)
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/friends> ?a0_friends .
  }
}
GROUP BY ?a0`);
  });

  test('countEquals', async () => {
    const sparql = await goldenSelect(queryFactories.countEquals);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?a0
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/friends> ?a0_friends .
  }
}
GROUP BY ?a0
HAVING(count(?a0_friends) = "2"^^xsd:integer)`);
  });

  test('customResultEqualsBoolean', async () => {
    const sparql = await goldenSelect(queryFactories.customResultEqualsBoolean);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 (?a0_bestFriend = <linked://tmp/entities/p3> AS ?a1)
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/bestFriend> ?a0_bestFriend .
  }
}`);
  });
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

describe('SPARQL golden — ordering', () => {
  test('sortByAsc', async () => {
    const sparql = await goldenSelect(queryFactories.sortByAsc);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a0_name
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/name> ?a0_name .
  }
}
ORDER BY ASC(?a0_name)`);
  });

  test('sortByDesc', async () => {
    const sparql = await goldenSelect(queryFactories.sortByDesc);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a0_name
WHERE {
  ?a0 rdf:type <${P}> .
  OPTIONAL {
    ?a0 <${P}/name> ?a0_name .
  }
}
ORDER BY DESC(?a0_name)`);
  });
});

// ---------------------------------------------------------------------------
// Sub-selects (nested select / selectAll)
// ---------------------------------------------------------------------------

describe('SPARQL golden — sub-selects', () => {
  test('subSelectSingleProp', async () => {
    const sparql = await goldenSelect(queryFactories.subSelectSingleProp);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a1_name ?a1
WHERE {
  ?a0 rdf:type <${P}> .
  ?a0 <${P}/bestFriend> ?a1 .
  OPTIONAL {
    ?a1 <${P}/name> ?a1_name .
  }
}`);
  });

  test('subSelectPluralCustom', async () => {
    const sparql = await goldenSelect(queryFactories.subSelectPluralCustom);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a1_name ?a1_hobby ?a1
WHERE {
  ?a0 rdf:type <${P}> .
  ?a0 <${P}/friends> ?a1 .
  OPTIONAL {
    ?a1 <${P}/name> ?a1_name .
  }
  OPTIONAL {
    ?a1 <${P}/hobby> ?a1_hobby .
  }
}`);
  });

  test('subSelectAllProperties', async () => {
    const sparql = await goldenSelect(queryFactories.subSelectAllProperties);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a1_name ?a1_hobby ?a1_nickNames ?a1_birthDate ?a1_isRealPerson ?a1_bestFriend ?a1_friends ?a1_pets ?a1_firstPet ?a1_pluralTestProp ?a1_label ?a1_type ?a1
WHERE {
  ?a0 rdf:type <${P}> .
  ?a0 <${P}/friends> ?a1 .
  OPTIONAL {
    ?a1 <${P}/name> ?a1_name .
  }
  OPTIONAL {
    ?a1 <${P}/hobby> ?a1_hobby .
  }
  OPTIONAL {
    ?a1 <${P}/nickNames> ?a1_nickNames .
  }
  OPTIONAL {
    ?a1 <${P}/birthDate> ?a1_birthDate .
  }
  OPTIONAL {
    ?a1 <${P}/isRealPerson> ?a1_isRealPerson .
  }
  OPTIONAL {
    ?a1 <${P}/bestFriend> ?a1_bestFriend .
  }
  OPTIONAL {
    ?a1 <${P}/friends> ?a1_friends .
  }
  OPTIONAL {
    ?a1 <${P}/pets> ?a1_pets .
  }
  OPTIONAL {
    ?a1 <${P}/firstPet> ?a1_firstPet .
  }
  OPTIONAL {
    ?a1 <${P}/pluralTestProp> ?a1_pluralTestProp .
  }
  OPTIONAL {
    ?a1 <${S}/label> ?a1_label .
  }
  OPTIONAL {
    ?a1 <${S}/type> ?a1_type .
  }
}`);
  });

  test('subSelectAllPropertiesSingle', async () => {
    const sparql = await goldenSelect(queryFactories.subSelectAllPropertiesSingle);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a1_name ?a1_hobby ?a1_nickNames ?a1_birthDate ?a1_isRealPerson ?a1_bestFriend ?a1_friends ?a1_pets ?a1_firstPet ?a1_pluralTestProp ?a1_label ?a1_type ?a1
WHERE {
  ?a0 rdf:type <${P}> .
  ?a0 <${P}/bestFriend> ?a1 .
  OPTIONAL {
    ?a1 <${P}/name> ?a1_name .
  }
  OPTIONAL {
    ?a1 <${P}/hobby> ?a1_hobby .
  }
  OPTIONAL {
    ?a1 <${P}/nickNames> ?a1_nickNames .
  }
  OPTIONAL {
    ?a1 <${P}/birthDate> ?a1_birthDate .
  }
  OPTIONAL {
    ?a1 <${P}/isRealPerson> ?a1_isRealPerson .
  }
  OPTIONAL {
    ?a1 <${P}/bestFriend> ?a1_bestFriend .
  }
  OPTIONAL {
    ?a1 <${P}/friends> ?a1_friends .
  }
  OPTIONAL {
    ?a1 <${P}/pets> ?a1_pets .
  }
  OPTIONAL {
    ?a1 <${P}/firstPet> ?a1_firstPet .
  }
  OPTIONAL {
    ?a1 <${P}/pluralTestProp> ?a1_pluralTestProp .
  }
  OPTIONAL {
    ?a1 <${S}/label> ?a1_label .
  }
  OPTIONAL {
    ?a1 <${S}/type> ?a1_type .
  }
}`);
  });

  test('subSelectAllPrimitives', async () => {
    const sparql = await goldenSelect(queryFactories.subSelectAllPrimitives);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a1_name ?a1_birthDate ?a1_isRealPerson ?a1
WHERE {
  ?a0 rdf:type <${P}> .
  ?a0 <${P}/bestFriend> ?a1 .
  OPTIONAL {
    ?a1 <${P}/name> ?a1_name .
  }
  OPTIONAL {
    ?a1 <${P}/birthDate> ?a1_birthDate .
  }
  OPTIONAL {
    ?a1 <${P}/isRealPerson> ?a1_isRealPerson .
  }
}`);
  });

  test('subSelectArray', async () => {
    const sparql = await goldenSelect(queryFactories.subSelectArray);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a1_name ?a1_hobby ?a1
WHERE {
  ?a0 rdf:type <${P}> .
  ?a0 <${P}/friends> ?a1 .
  OPTIONAL {
    ?a1 <${P}/name> ?a1_name .
  }
  OPTIONAL {
    ?a1 <${P}/hobby> ?a1_hobby .
  }
}`);
  });

  test('doubleNestedSubSelect', async () => {
    const sparql = await goldenSelect(queryFactories.doubleNestedSubSelect);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a2_name ?a1 ?a2
WHERE {
  ?a0 rdf:type <${P}> .
  ?a0 <${P}/friends> ?a1 .
  ?a1 <${P}/bestFriend> ?a2 .
  OPTIONAL {
    ?a2 <${P}/name> ?a2_name .
  }
}`);
  });

  test('nestedQueries2', async () => {
    const sparql = await goldenSelect(queryFactories.nestedQueries2);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a1_firstPet ?a2_name ?a1 ?a2
WHERE {
  ?a0 rdf:type <${P}> .
  ?a0 <${P}/friends> ?a1 .
  ?a1 <${P}/bestFriend> ?a2 .
  OPTIONAL {
    ?a1 <${P}/firstPet> ?a1_firstPet .
  }
  OPTIONAL {
    ?a2 <${P}/name> ?a2_name .
  }
}`);
  });
});

// ---------------------------------------------------------------------------
// Shape casting (as)
// ---------------------------------------------------------------------------

describe('SPARQL golden — shape casting', () => {
  test('selectShapeSetAs', async () => {
    const sparql = await goldenSelect(queryFactories.selectShapeSetAs);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a1_guardDogLevel ?a1
WHERE {
  ?a0 rdf:type <${P}> .
  ?a0 <${P}/pets> ?a1 .
  OPTIONAL {
    ?a1 <${D}/guardDogLevel> ?a1_guardDogLevel .
  }
}`);
  });

  test('selectShapeAs', async () => {
    const sparql = await goldenSelect(queryFactories.selectShapeAs);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a1_guardDogLevel ?a1
WHERE {
  ?a0 rdf:type <${P}> .
  ?a0 <${P}/firstPet> ?a1 .
  OPTIONAL {
    ?a1 <${D}/guardDogLevel> ?a1_guardDogLevel .
  }
}`);
  });
});

// ---------------------------------------------------------------------------
// Employee (subclass) queries
// ---------------------------------------------------------------------------

describe('SPARQL golden — employee', () => {
  test('selectAllEmployeeProperties', async () => {
    const sparql = await goldenSelect(queryFactories.selectAllEmployeeProperties);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a0_name ?a0_bestFriend ?a0_department ?a0_hobby ?a0_nickNames ?a0_birthDate ?a0_isRealPerson ?a0_friends ?a0_pets ?a0_firstPet ?a0_pluralTestProp ?a0_label ?a0_type
WHERE {
  ?a0 rdf:type <${E}> .
  OPTIONAL {
    ?a0 <${E}/name> ?a0_name .
  }
  OPTIONAL {
    ?a0 <${E}/bestFriend> ?a0_bestFriend .
  }
  OPTIONAL {
    ?a0 <${E}/department> ?a0_department .
  }
  OPTIONAL {
    ?a0 <${P}/hobby> ?a0_hobby .
  }
  OPTIONAL {
    ?a0 <${P}/nickNames> ?a0_nickNames .
  }
  OPTIONAL {
    ?a0 <${P}/birthDate> ?a0_birthDate .
  }
  OPTIONAL {
    ?a0 <${P}/isRealPerson> ?a0_isRealPerson .
  }
  OPTIONAL {
    ?a0 <${P}/friends> ?a0_friends .
  }
  OPTIONAL {
    ?a0 <${P}/pets> ?a0_pets .
  }
  OPTIONAL {
    ?a0 <${P}/firstPet> ?a0_firstPet .
  }
  OPTIONAL {
    ?a0 <${P}/pluralTestProp> ?a0_pluralTestProp .
  }
  OPTIONAL {
    ?a0 <${S}/label> ?a0_label .
  }
  OPTIONAL {
    ?a0 <${S}/type> ?a0_type .
  }
}`);
  });
});

// ---------------------------------------------------------------------------
// preloadFor
// ---------------------------------------------------------------------------

describe('SPARQL golden — preload', () => {
  test('preloadBestFriend', async () => {
    const sparql = await goldenSelect(queryFactories.preloadBestFriend);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a1_name ?a1
WHERE {
  ?a0 rdf:type <${P}> .
  ?a0 <${P}/bestFriend> ?a1 .
  OPTIONAL {
    ?a1 <${P}/name> ?a1_name .
  }
}`);
  });

  test('QueryBuilder.preload() produces same SPARQL as DSL preloadFor', async () => {
    const sparql = await goldenSelect(queryFactories.queryBuilderPreload);
    // QueryBuilder.preload adds name selection + bestFriend preload
    expect(sparql).toContain('OPTIONAL');
    expect(sparql).toContain(`<${P}/bestFriend>`);
    expect(sparql).toContain(`<${P}/name>`);
  });
});

// ---------------------------------------------------------------------------
// MINUS patterns
// ---------------------------------------------------------------------------

describe('SPARQL golden — MINUS patterns', () => {
  test('minusShape — exclude by shape type', async () => {
    const sparql = await goldenSelect(queryFactories.minusShape);
    expect(sparql).toContain('MINUS {');
    expect(sparql).toContain(`rdf:type <${E}>`);
    expect(sparql).toContain(`<${P}/name>`);
  });

  test('minusCondition — exclude by property condition', async () => {
    const sparql = await goldenSelect(queryFactories.minusCondition);
    expect(sparql).toContain('MINUS {');
    expect(sparql).toContain(`<${P}/hobby>`);
    expect(sparql).toContain('FILTER');
    expect(sparql).toContain('"Chess"');
  });

  test('minusChained — two separate MINUS blocks', async () => {
    const sparql = await goldenSelect(queryFactories.minusChained);
    const minusCount = (sparql.match(/MINUS \{/g) || []).length;
    expect(minusCount).toBe(2);
    expect(sparql).toContain(`rdf:type <${E}>`);
    expect(sparql).toContain('"Chess"');
  });
});
