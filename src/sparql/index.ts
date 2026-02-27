// Types
export type * from './SparqlAlgebra.js';
export type {SparqlOptions} from './sparqlUtils.js';

// Utilities
export {
  formatUri,
  formatLiteral,
  collectPrefixes,
  generateEntityUri,
} from './sparqlUtils.js';

// IR → Algebra conversion (Layer 1)
export {
  selectToAlgebra,
  createToAlgebra,
  updateToAlgebra,
  deleteToAlgebra,
} from './irToAlgebra.js';

// High-level IR → SPARQL string (convenience wrappers)
export {
  selectToSparql,
  createToSparql,
  updateToSparql,
  deleteToSparql,
} from './irToAlgebra.js';

// Algebra → SPARQL string serialization (layer 3)
export {
  serializeAlgebraNode,
  serializeExpression,
  serializeTerm,
  selectPlanToSparql,
  insertDataPlanToSparql,
  deleteInsertPlanToSparql,
  deleteWherePlanToSparql,
} from './algebraToString.js';

// Result mapping
export {
  mapSparqlSelectResult,
  mapSparqlCreateResult,
  mapSparqlUpdateResult,
} from './resultMapping.js';
export type {SparqlJsonResults, SparqlBinding} from './resultMapping.js';
