/**
 * Relation CRUD — Create, query, and lifecycle management for graph edges.
 *
 * Relations are the directed edges in the Causal State Graph, connecting
 * entities with typed, temporal, and causally-tracked links.
 */

import { v7 as uuidv7 } from "uuid";
import type {
  Relation,
  RelationType,
  PropertyValue,
} from "./types.js";

/**
 * Options for creating a new relation.
 */
export interface CreateRelationOptions {
  type: RelationType;
  source: string;      // Entity ID
  target: string;      // Entity ID
  properties?: Record<string, PropertyValue>;
  causal_chain?: string[];
}

/**
 * Create a new relation between two entities.
 */
export function createRelation(
  currentTick: number,
  options: CreateRelationOptions
): Relation {
  return {
    id: uuidv7(),
    type: options.type,
    source: options.source,
    target: options.target,
    properties: new Map(Object.entries(options.properties ?? {})),
    causal_chain: options.causal_chain,
    valid_from: currentTick,
    valid_until: null,
  };
}

/**
 * "Soft delete" a relation by setting its valid_until tick.
 * Returns a new relation object (immutable).
 */
export function deactivateRelation(
  relation: Relation,
  currentTick: number
): Relation {
  return {
    ...relation,
    valid_until: currentTick,
  };
}

/**
 * Check if a relation is currently active (valid_until is null or in the future).
 */
export function isRelationActive(
  relation: Relation,
  currentTick: number
): boolean {
  return relation.valid_until === null || relation.valid_until > currentTick;
}

/**
 * Set a property on a relation.
 */
export function setRelationProperty(
  relation: Relation,
  key: string,
  value: PropertyValue
): Relation {
  const newProperties = new Map(relation.properties);
  newProperties.set(key, value);
  return {
    ...relation,
    properties: newProperties,
  };
}

/**
 * Filter relations by type and activity status.
 */
export function filterRelations(
  relations: Relation[],
  filters: {
    type?: RelationType;
    source?: string;
    target?: string;
    activeOnly?: boolean;
    currentTick?: number;
  }
): Relation[] {
  return relations.filter((r) => {
    if (filters.type && r.type !== filters.type) return false;
    if (filters.source && r.source !== filters.source) return false;
    if (filters.target && r.target !== filters.target) return false;
    if (filters.activeOnly && filters.currentTick !== undefined) {
      if (!isRelationActive(r, filters.currentTick)) return false;
    }
    return true;
  });
}

/**
 * Find all relation targets of a given type from a source entity.
 */
export function getRelatedEntityIds(
  relations: Relation[],
  sourceId: string,
  relationType: RelationType,
  currentTick: number
): string[] {
  return relations
    .filter(
      (r) =>
        r.source === sourceId &&
        r.type === relationType &&
        isRelationActive(r, currentTick)
    )
    .map((r) => r.target);
}

/**
 * Find all relation sources of a given type targeting an entity.
 */
export function getIncomingEntityIds(
  relations: Relation[],
  targetId: string,
  relationType: RelationType,
  currentTick: number
): string[] {
  return relations
    .filter(
      (r) =>
        r.target === targetId &&
        r.type === relationType &&
        isRelationActive(r, currentTick)
    )
    .map((r) => r.source);
}

/**
 * Check if a specific relation exists between two entities.
 */
export function relationExists(
  relations: Relation[],
  sourceId: string,
  targetId: string,
  relationType: RelationType,
  currentTick: number
): boolean {
  return relations.some(
    (r) =>
      r.source === sourceId &&
      r.target === targetId &&
      r.type === relationType &&
      isRelationActive(r, currentTick)
  );
}
