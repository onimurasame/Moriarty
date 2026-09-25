/**
 * Snapshot — Serialization, deserialization, and replay for the CSG.
 *
 * WorldSnapshots are the interchange format for persistence, UE bridge,
 * and deterministic replay.
 */

import type {
  Entity,
  Relation,
  EventEntry,
  WorldSnapshot,
  SerializedEntity,
  SerializedRelation,
  StateDelta,
} from "../types.js";

/**
 * Serialize an Entity (convert Maps to Records for JSON compatibility).
 */
export function serializeEntity(entity: Entity): SerializedEntity {
  return {
    id: entity.id,
    type: entity.type,
    name: entity.name,
    properties: Object.fromEntries(entity.properties),
    components: Object.fromEntries(entity.components),
    relations: entity.relations,
    metadata: { ...entity.metadata },
  };
}

/**
 * Deserialize an Entity (convert Records back to Maps).
 */
export function deserializeEntity(data: SerializedEntity): Entity {
  return {
    id: data.id,
    type: data.type,
    name: data.name,
    properties: new Map(Object.entries(data.properties)),
    components: new Map(Object.entries(data.components)),
    relations: [...data.relations],
    metadata: { ...data.metadata },
  };
}

/**
 * Serialize a Relation.
 */
export function serializeRelation(relation: Relation): SerializedRelation {
  return {
    id: relation.id,
    type: relation.type,
    source: relation.source,
    target: relation.target,
    properties: Object.fromEntries(relation.properties),
    causal_chain: relation.causal_chain ? [...relation.causal_chain] : undefined,
    valid_from: relation.valid_from,
    valid_until: relation.valid_until,
  };
}

/**
 * Deserialize a Relation.
 */
export function deserializeRelation(data: SerializedRelation): Relation {
  return {
    id: data.id,
    type: data.type,
    source: data.source,
    target: data.target,
    properties: new Map(Object.entries(data.properties)),
    causal_chain: data.causal_chain ? [...data.causal_chain] : undefined,
    valid_from: data.valid_from,
    valid_until: data.valid_until,
  };
}

/**
 * Create a full world snapshot from current state.
 */
export function createSnapshot(
  entities: Map<string, Entity>,
  relations: Map<string, Relation>,
  eventLog: EventEntry[],
  currentTick: number
): WorldSnapshot {
  const serializedEntities: Record<string, SerializedEntity> = {};
  for (const [id, entity] of entities) {
    serializedEntities[id] = serializeEntity(entity);
  }

  const serializedRelations: Record<string, SerializedRelation> = {};
  for (const [id, relation] of relations) {
    serializedRelations[id] = serializeRelation(relation);
  }

  return {
    tick: currentTick,
    timestamp: Date.now(),
    entities: serializedEntities,
    relations: serializedRelations,
    event_count: eventLog.length,
  };
}

/**
 * Restore entities and relations from a snapshot.
 */
export function restoreFromSnapshot(
  snapshot: WorldSnapshot
): {
  entities: Map<string, Entity>;
  relations: Map<string, Relation>;
  tick: number;
} {
  const entities = new Map<string, Entity>();
  for (const [id, data] of Object.entries(snapshot.entities)) {
    entities.set(id, deserializeEntity(data));
  }

  const relations = new Map<string, Relation>();
  for (const [id, data] of Object.entries(snapshot.relations)) {
    relations.set(id, deserializeRelation(data));
  }

  return { entities, relations, tick: snapshot.tick };
}

/**
 * Calculate the state delta between two snapshots.
 *
 * Used by the UE bridge to send minimal updates per tick.
 */
export function calculateDelta(
  previous: WorldSnapshot,
  current: WorldSnapshot,
  newEvents: EventEntry[]
): StateDelta {
  const delta: StateDelta = {
    tick: current.tick,
    entities_added: [],
    entities_modified: [],
    entities_removed: [],
    relations_added: [],
    relations_removed: [],
    events: newEvents,
  };

  // Entities added
  for (const [id, entity] of Object.entries(current.entities)) {
    if (!(id in previous.entities)) {
      delta.entities_added.push(entity);
    }
  }

  // Entities removed
  for (const id of Object.keys(previous.entities)) {
    if (!(id in current.entities)) {
      delta.entities_removed.push(id);
    }
  }

  // Entities modified (compare versions)
  for (const [id, entity] of Object.entries(current.entities)) {
    if (id in previous.entities) {
      const prevEntity = previous.entities[id];
      if (entity.metadata.version !== prevEntity.metadata.version) {
        delta.entities_modified.push({
          id,
          changes: entity,
        });
      }
    }
  }

  // Relations added
  for (const [id, relation] of Object.entries(current.relations)) {
    if (!(id in previous.relations)) {
      delta.relations_added.push(relation);
    }
  }

  // Relations removed (or newly deactivated)
  for (const id of Object.keys(previous.relations)) {
    if (!(id in current.relations)) {
      delta.relations_removed.push(id);
    } else {
      const prev = previous.relations[id];
      const curr = current.relations[id];
      // Relation was active, now deactivated
      if (prev.valid_until === null && curr.valid_until !== null) {
        delta.relations_removed.push(id);
      }
    }
  }

  return delta;
}
