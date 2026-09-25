/**
 * Graph Query Engine — Structured queries over the Causal State Graph.
 *
 * Provides both typed query operations and a natural-language-friendly
 * query interface for agent tool calls.
 */

import type {
  Entity,
  EntityType,
  Relation,
  RelationType,
  EventEntry,
  GraphQuery,
  QueryResult,
  Vector3,
} from "../types.js";
import { isRelationActive } from "./relation.js";
import { getPosition } from "./entity.js";

/**
 * Calculate Euclidean distance between two 3D points.
 */
export function distance3D(a: Vector3, b: Vector3): number {
  return Math.sqrt(
    (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2
  );
}

/**
 * Execute a structured query against the graph state.
 */
export function executeQuery(
  entities: Map<string, Entity>,
  relations: Map<string, Relation>,
  eventLog: EventEntry[],
  currentTick: number,
  query: GraphQuery
): QueryResult {
  switch (query.type) {
    case "entities_by_type":
      return queryEntitiesByType(
        entities,
        (query.params.entity_type ?? query.params.type) as EntityType
      );

    case "entities_by_tag":
      return queryEntitiesByTag(entities, query.params.tag as string);

    case "entities_in_location":
      return queryEntitiesInLocation(
        entities,
        relations,
        (query.params.location_id ?? query.params.entity_id) as string,
        currentTick
      );

    case "relations_of":
      return queryRelationsOf(
        relations,
        query.params.entity_id as string,
        query.params.relation_type as RelationType | undefined,
        currentTick
      );

    case "entities_near":
      return queryEntitiesNear(
        entities,
        (query.params.position ?? query.params.center) as Vector3,
        (query.params.radius ?? query.params.max_distance) as number
      );

    case "events_caused_by":
      return queryEventsCausedBy(eventLog, query.params.event_id as string);

    case "events_at_tick":
      return queryEventsAtTick(eventLog, query.params.tick as number);

    case "path_between":
      return queryPathBetween(
        entities,
        relations,
        (query.params.source_id ?? query.params.start_id) as string,
        (query.params.target_id ?? query.params.end_id) as string,
        currentTick
      );

    default:
      return { count: 0 };
  }
}

// ─── Individual Query Implementations ─────────────────────────────────────────

function queryEntitiesByType(
  entities: Map<string, Entity>,
  entityType: EntityType
): QueryResult {
  const results = [...entities.values()].filter((e) => e.type === entityType);
  return { entities: results, count: results.length };
}

function queryEntitiesByTag(
  entities: Map<string, Entity>,
  tag: string
): QueryResult {
  const results = [...entities.values()].filter((e) =>
    e.metadata.tags.includes(tag)
  );
  return { entities: results, count: results.length };
}

function queryEntitiesInLocation(
  entities: Map<string, Entity>,
  relations: Map<string, Relation>,
  locationId: string,
  currentTick: number
): QueryResult {
  const activeRelations = [...relations.values()].filter(
    (r) =>
      r.type === "located_in" &&
      r.target === locationId &&
      isRelationActive(r, currentTick)
  );

  const entityIds = new Set(activeRelations.map((r) => r.source));
  const results = [...entities.values()].filter((e) => entityIds.has(e.id));

  return { entities: results, relations: activeRelations, count: results.length };
}

function queryRelationsOf(
  relations: Map<string, Relation>,
  entityId: string,
  relationType: RelationType | undefined,
  currentTick: number
): QueryResult {
  const results = [...relations.values()].filter((r) => {
    const involveEntity = r.source === entityId || r.target === entityId;
    const isActive = isRelationActive(r, currentTick);
    const matchesType = relationType ? r.type === relationType : true;
    return involveEntity && isActive && matchesType;
  });
  return { relations: results, count: results.length };
}

function queryEntitiesNear(
  entities: Map<string, Entity>,
  position: Vector3,
  radius: number
): QueryResult {
  const results = [...entities.values()].filter((e) => {
    const pos = getPosition(e);
    if (!pos) return false;
    return distance3D(pos, position) <= radius;
  });
  return { entities: results, count: results.length };
}

function queryEventsCausedBy(
  eventLog: EventEntry[],
  eventId: string
): QueryResult {
  // Find all events in the causal chain stemming from this event
  const directChildren = eventLog.filter((e) => e.caused_by === eventId);
  const allDescendants: EventEntry[] = [];
  const queue = [...directChildren];

  while (queue.length > 0) {
    const current = queue.shift()!;
    allDescendants.push(current);
    const children = eventLog.filter((e) => e.caused_by === current.id);
    queue.push(...children);
  }

  return { events: allDescendants, count: allDescendants.length };
}

function queryEventsAtTick(
  eventLog: EventEntry[],
  tick: number
): QueryResult {
  const results = eventLog.filter((e) => e.tick === tick);
  return { events: results, count: results.length };
}

function queryPathBetween(
  entities: Map<string, Entity>,
  relations: Map<string, Relation>,
  sourceId: string,
  targetId: string,
  currentTick: number
): QueryResult {
  // BFS to find shortest path via active relations
  const visited = new Set<string>();
  const queue: Array<{ id: string; path: string[] }> = [
    { id: sourceId, path: [sourceId] },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.id === targetId) {
      return { paths: [current.path], count: 1 };
    }

    if (visited.has(current.id)) continue;
    visited.add(current.id);

    // Find all active relations from current entity
    const outgoing = [...relations.values()].filter(
      (r) => r.source === current.id && isRelationActive(r, currentTick)
    );

    for (const rel of outgoing) {
      if (!visited.has(rel.target) && entities.has(rel.target)) {
        queue.push({
          id: rel.target,
          path: [...current.path, rel.target],
        });
      }
    }
  }

  return { paths: [], count: 0 };
}
