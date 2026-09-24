/**
 * CausalStateGraph — The central runtime data structure.
 *
 * A temporal, directed graph of entities, relations, and events.
 * This is the single source of truth for all world state in Moriarty.
 *
 * Design principles:
 * - All mutations are tracked via the append-only event log
 * - Every state change requires a causal justification
 * - The graph is deterministically replayable from the event log
 * - Snapshots provide efficient serialization points
 */

import { v7 as uuidv7 } from "uuid";
import type {
  Entity,
  EntityType,
  Relation,
  RelationType,
  EventEntry,
  ActionRequest,
  ActionResult,
  ActionSchema,
  Effect,
  GraphQuery,
  QueryResult,
  WorldSnapshot,
  OntologySchema,
  PropertyValue,
  Vector3,
  Component,
} from "./types.js";
import {
  createEntity,
  setEntityProperty,
  addRelationRef,
  removeRelationRef,
  getPosition,
  type CreateEntityOptions,
} from "./entity.js";
import {
  createRelation,
  deactivateRelation,
  isRelationActive,
  type CreateRelationOptions,
} from "./relation.js";
import { executeQuery, distance3D } from "./query.js";
import { createSnapshot, restoreFromSnapshot, calculateDelta } from "./snapshot.js";

/**
 * Callback invoked on every tick, receiving the events that occurred.
 */
export type TickCallback = (tick: number, events: EventEntry[]) => void;

export class CausalStateGraph {
  // ─── State ────────────────────────────────────────────────────────────────
  private _entities: Map<string, Entity> = new Map();
  private _relations: Map<string, Relation> = new Map();
  private _eventLog: EventEntry[] = [];
  private _currentTick: number = 0;
  private _schema: OntologySchema | null = null;
  private _actionRegistry: Map<string, ActionSchema> = new Map();
  private _tickCallbacks: TickCallback[] = [];
  private _previousSnapshot: WorldSnapshot | null = null;

  // ─── Getters ──────────────────────────────────────────────────────────────

  get currentTick(): number {
    return this._currentTick;
  }

  get entityCount(): number {
    return this._entities.size;
  }

  get relationCount(): number {
    return this._relations.size;
  }

  get eventCount(): number {
    return this._eventLog.length;
  }

  get schema(): OntologySchema | null {
    return this._schema;
  }

  // ─── Schema & Initialization ──────────────────────────────────────────────

  /**
   * Load an ontology schema and register its action definitions.
   */
  loadSchema(schema: OntologySchema): void {
    this._schema = schema;
    this._actionRegistry.clear();
    for (const action of schema.actions) {
      this._actionRegistry.set(action.id, action);
    }
  }

  /**
   * Register a tick callback.
   */
  onTick(callback: TickCallback): void {
    this._tickCallbacks.push(callback);
  }

  // ─── Entity Operations ────────────────────────────────────────────────────

  /**
   * Add a new entity to the graph.
   */
  addEntity(options: CreateEntityOptions): Entity {
    const entity = createEntity(this._currentTick, options);
    this._entities.set(entity.id, entity);
    return entity;
  }

  /**
   * Get an entity by ID.
   */
  getEntity(id: string): Entity | undefined {
    return this._entities.get(id);
  }

  /**
   * Get all entities.
   */
  getAllEntities(): Entity[] {
    return [...this._entities.values()];
  }

  /**
   * Get entities by type.
   */
  getEntitiesByType(type: EntityType): Entity[] {
    return [...this._entities.values()].filter((e) => e.type === type);
  }

  /**
   * Update an entity's property. Returns the updated entity.
   */
  setProperty(entityId: string, key: string, value: PropertyValue): Entity {
    const entity = this._entities.get(entityId);
    if (!entity) throw new Error(`Entity not found: ${entityId}`);

    const updated = setEntityProperty(entity, key, value, this._currentTick);
    this._entities.set(entityId, updated);
    return updated;
  }

  /**
   * Remove an entity and all its active relations.
   */
  removeEntity(entityId: string): void {
    const entity = this._entities.get(entityId);
    if (!entity) return;

    // Deactivate all relations involving this entity
    for (const [relId, relation] of this._relations) {
      if (
        (relation.source === entityId || relation.target === entityId) &&
        isRelationActive(relation, this._currentTick)
      ) {
        this._relations.set(relId, deactivateRelation(relation, this._currentTick));
      }
    }

    this._entities.delete(entityId);
  }

  // ─── Relation Operations ──────────────────────────────────────────────────

  /**
   * Add a new relation between entities.
   */
  addRelation(options: CreateRelationOptions): Relation {
    // Validate entities exist
    if (!this._entities.has(options.source)) {
      throw new Error(`Source entity not found: ${options.source}`);
    }
    if (!this._entities.has(options.target)) {
      throw new Error(`Target entity not found: ${options.target}`);
    }

    const relation = createRelation(this._currentTick, options);
    this._relations.set(relation.id, relation);

    // Update entity relation refs
    const sourceEntity = this._entities.get(options.source)!;
    const targetEntity = this._entities.get(options.target)!;
    this._entities.set(options.source, addRelationRef(sourceEntity, relation.id));
    this._entities.set(options.target, addRelationRef(targetEntity, relation.id));

    return relation;
  }

  /**
   * Get a relation by ID.
   */
  getRelation(id: string): Relation | undefined {
    return this._relations.get(id);
  }

  /**
   * Get all active relations.
   */
  getActiveRelations(): Relation[] {
    return [...this._relations.values()].filter((r) =>
      isRelationActive(r, this._currentTick)
    );
  }

  /**
   * Deactivate a relation (soft delete with temporal tracking).
   */
  deactivateRelation(relationId: string): void {
    const relation = this._relations.get(relationId);
    if (!relation) return;

    const deactivated = deactivateRelation(relation, this._currentTick);
    this._relations.set(relationId, deactivated);

    // Remove relation refs from entities
    const sourceEntity = this._entities.get(relation.source);
    const targetEntity = this._entities.get(relation.target);
    if (sourceEntity) {
      this._entities.set(
        relation.source,
        removeRelationRef(sourceEntity, relationId)
      );
    }
    if (targetEntity) {
      this._entities.set(
        relation.target,
        removeRelationRef(targetEntity, relationId)
      );
    }
  }

  /**
   * Check if a relation of a given type exists between two entities.
   */
  hasRelation(
    sourceId: string,
    targetId: string,
    type: RelationType
  ): boolean {
    return [...this._relations.values()].some(
      (r) =>
        r.source === sourceId &&
        r.target === targetId &&
        r.type === type &&
        isRelationActive(r, this._currentTick)
    );
  }

  /**
   * Find all entity IDs related to a source via a given relation type.
   */
  getRelatedIds(sourceId: string, type: RelationType): string[] {
    return [...this._relations.values()]
      .filter(
        (r) =>
          r.source === sourceId &&
          r.type === type &&
          isRelationActive(r, this._currentTick)
      )
      .map((r) => r.target);
  }

  // ─── Action Execution ─────────────────────────────────────────────────────

  /**
   * Attempt to execute an action. Validates preconditions, applies effects,
   * and records the event.
   */
  applyAction(request: ActionRequest): ActionResult {
    const schema = this._actionRegistry.get(request.action_id);
    if (!schema) {
      return {
        success: false,
        action_id: request.action_id,
        actor_id: request.actor_id,
        tick: this._currentTick,
        effects_applied: [],
        failure_reason: `Unknown action: ${request.action_id}`,
      };
    }

    // Validate actor exists and is of an allowed type
    const actor = this._entities.get(request.actor_id);
    if (!actor) {
      return {
        success: false,
        action_id: request.action_id,
        actor_id: request.actor_id,
        tick: this._currentTick,
        effects_applied: [],
        failure_reason: `Actor not found: ${request.actor_id}`,
      };
    }

    if (!schema.actor_types.includes(actor.type)) {
      return {
        success: false,
        action_id: request.action_id,
        actor_id: request.actor_id,
        tick: this._currentTick,
        effects_applied: [],
        failure_reason: `Actor type "${actor.type}" cannot perform "${schema.name}"`,
      };
    }

    // Validate preconditions
    const failedConditions = schema.preconditions.filter(
      (cond) => !this.evaluateCondition(cond, request)
    );

    if (failedConditions.length > 0) {
      const eventId = this.recordEvent({
        action: request.action_id,
        actor: request.actor_id,
        targets: request.target_ids,
        preconditions_met: false,
        effects_applied: [],
      });

      return {
        success: false,
        action_id: request.action_id,
        actor_id: request.actor_id,
        tick: this._currentTick,
        event_id: eventId,
        effects_applied: [],
        failure_reason: `Preconditions not met`,
        failed_conditions: failedConditions,
      };
    }

    // Apply effects
    const appliedEffects: Effect[] = [];
    for (const effect of schema.effects) {
      try {
        this.applyEffect(effect, request);
        appliedEffects.push(effect);
      } catch (err) {
        // Log but continue — partial application is recorded
        console.error(`Effect application failed:`, err);
      }
    }

    // Record the event
    const eventId = this.recordEvent({
      action: request.action_id,
      actor: request.actor_id,
      targets: request.target_ids,
      preconditions_met: true,
      effects_applied: appliedEffects,
    });

    return {
      success: true,
      action_id: request.action_id,
      actor_id: request.actor_id,
      tick: this._currentTick,
      event_id: eventId,
      effects_applied: appliedEffects,
    };
  }

  // ─── Condition Evaluation ─────────────────────────────────────────────────

  private evaluateCondition(
    condition: { type: string; params: Record<string, unknown> },
    request: ActionRequest
  ): boolean {
    switch (condition.type) {
      case "property_check": {
        // Default to checking the target entity (for actions like pick_up that
        // check target properties). Fall back to actor if no targets.
        const entityId =
          (condition.params.entity_id as string) ??
          request.target_ids[0] ??
          request.actor_id;
        const entity = this._entities.get(entityId);
        if (!entity) return false;

        const prop = entity.properties.get(condition.params.property as string);
        if (!prop) return false;

        const operator = (condition.params.operator as string) ?? "eq";
        const expected = condition.params.value;

        if (prop.type === "number" && typeof expected === "number") {
          switch (operator) {
            case "eq": return prop.value === expected;
            case "gt": return prop.value > expected;
            case "gte": return prop.value >= expected;
            case "lt": return prop.value < expected;
            case "lte": return prop.value <= expected;
            default: return false;
          }
        }
        if (prop.type === "boolean" && typeof expected === "boolean") {
          return prop.value === expected;
        }
        if (prop.type === "string" && typeof expected === "string") {
          return prop.value === expected;
        }
        return false;
      }

      case "relation_exists": {
        const source = (condition.params.source as string) ?? request.actor_id;
        const target =
          (condition.params.target as string) ??
          request.target_ids[0];
        const relType = condition.params.relation_type as RelationType;
        return this.hasRelation(source, target, relType);
      }

      case "relation_absent": {
        const source = (condition.params.source as string) ?? request.actor_id;
        const target =
          (condition.params.target as string) ??
          request.target_ids[0];
        const relType = condition.params.relation_type as RelationType;
        return !this.hasRelation(source, target, relType);
      }

      case "proximity": {
        const actorPos = getPosition(this._entities.get(request.actor_id)!);
        const targetPos = getPosition(
          this._entities.get(request.target_ids[0] ?? "")!
        );
        if (!actorPos || !targetPos) return false;
        const maxDistance = (condition.params.max_distance as number) ?? 5;
        return distance3D(actorPos, targetPos) <= maxDistance;
      }

      case "inventory_has": {
        const entity = this._entities.get(request.actor_id);
        if (!entity) return false;
        const inventoryComp = entity.components.get("inventory");
        if (!inventoryComp) return false;
        const itemId = condition.params.item_id as string;
        const items = inventoryComp.data["items"];
        if (!items || items.type !== "list") return false;
        return items.value.some(
          (v) => v.type === "ref" && v.value === itemId
        );
      }

      case "entity_type_is": {
        const entityId = (condition.params.entity_id as string) ?? request.target_ids[0];
        const entity = this._entities.get(entityId ?? "");
        if (!entity) return false;
        return entity.type === (condition.params.expected_type as string);
      }

      default:
        // Unknown conditions are treated as unmet (safe default)
        return false;
    }
  }

  // ─── Effect Application ───────────────────────────────────────────────────

  private applyEffect(effect: Effect, request: ActionRequest): void {
    switch (effect.type) {
      case "set_property": {
        const entityId = (effect.params.entity_id as string) ?? request.actor_id;
        const key = effect.params.property as string;
        const value = effect.params.value as PropertyValue;
        this.setProperty(entityId, key, value);
        break;
      }

      case "modify_property": {
        const entityId = (effect.params.entity_id as string) ?? request.actor_id;
        const key = effect.params.property as string;
        const delta = effect.params.delta as number;
        const entity = this._entities.get(entityId);
        if (!entity) break;
        const current = entity.properties.get(key);
        if (!current || current.type !== "number") break;

        let newValue = current.value + delta;
        // Clamp to min/max if defined
        if (current.min !== undefined) newValue = Math.max(current.min, newValue);
        if (current.max !== undefined) newValue = Math.min(current.max, newValue);

        this.setProperty(entityId, key, {
          type: "number",
          value: newValue,
          min: current.min,
          max: current.max,
        });
        break;
      }

      case "add_relation": {
        const source = (effect.params.source as string) ?? request.actor_id;
        const target = (effect.params.target as string) ?? request.target_ids[0];
        const relType = effect.params.relation_type as RelationType;
        this.addRelation({ type: relType, source, target });
        break;
      }

      case "remove_relation": {
        const source = (effect.params.source as string) ?? request.actor_id;
        const target = (effect.params.target as string) ?? request.target_ids[0];
        const relType = effect.params.relation_type as RelationType;

        // Find and deactivate matching relation
        for (const [id, rel] of this._relations) {
          if (
            rel.source === source &&
            rel.target === target &&
            rel.type === relType &&
            isRelationActive(rel, this._currentTick)
          ) {
            this.deactivateRelation(id);
            break;
          }
        }
        break;
      }

      case "create_entity": {
        this.addEntity(effect.params as CreateEntityOptions);
        break;
      }

      case "destroy_entity": {
        const entityId = (effect.params.entity_id as string) ?? request.target_ids[0];
        this.removeEntity(entityId);
        break;
      }

      case "emit_event": {
        // Emit a secondary event (causal chaining)
        this.recordEvent({
          action: effect.params.action as string,
          actor: request.actor_id,
          targets: (effect.params.targets as string[]) ?? [],
          preconditions_met: true,
          effects_applied: [],
          caused_by: effect.params.parent_event_id as string | undefined,
        });
        break;
      }

      default:
        console.warn(`Unknown effect type: ${effect.type}`);
    }
  }

  // ─── Event Log ────────────────────────────────────────────────────────────

  /**
   * Record an event in the append-only log.
   */
  private recordEvent(params: {
    action: string;
    actor: string;
    targets: string[];
    preconditions_met: boolean;
    effects_applied: Effect[];
    caused_by?: string;
  }): string {
    const entry: EventEntry = {
      id: uuidv7(),
      tick: this._currentTick,
      action: params.action,
      actor: params.actor,
      targets: params.targets,
      preconditions_met: params.preconditions_met,
      effects_applied: params.effects_applied,
      caused_by: params.caused_by,
      timestamp: Date.now(),
    };
    this._eventLog.push(entry);
    return entry.id;
  }

  /**
   * Get the full event log.
   */
  getEventLog(): ReadonlyArray<EventEntry> {
    return this._eventLog;
  }

  /**
   * Get events for a specific tick.
   */
  getEventsAtTick(tick: number): EventEntry[] {
    return this._eventLog.filter((e) => e.tick === tick);
  }

  // ─── Query ────────────────────────────────────────────────────────────────

  /**
   * Execute a structured query against the graph.
   */
  query(q: GraphQuery): QueryResult {
    return executeQuery(
      this._entities,
      this._relations,
      this._eventLog,
      this._currentTick,
      q
    );
  }

  // ─── Tick Management ──────────────────────────────────────────────────────

  /**
   * Advance the simulation by one tick.
   * Takes a snapshot before advancing for delta calculation.
   */
  advanceTick(): { tick: number; events: EventEntry[] } {
    const tickEvents = this.getEventsAtTick(this._currentTick);

    // Notify callbacks
    for (const cb of this._tickCallbacks) {
      cb(this._currentTick, tickEvents);
    }

    // Store snapshot for delta calculation
    this._previousSnapshot = this.snapshot();

    this._currentTick += 1;

    return { tick: this._currentTick, events: tickEvents };
  }

  // ─── Snapshot & Replay ────────────────────────────────────────────────────

  /**
   * Create a full serializable snapshot of current state.
   */
  snapshot(): WorldSnapshot {
    return createSnapshot(
      this._entities,
      this._relations,
      this._eventLog,
      this._currentTick
    );
  }

  /**
   * Restore state from a snapshot.
   */
  restore(snapshot: WorldSnapshot): void {
    const restored = restoreFromSnapshot(snapshot);
    this._entities = restored.entities;
    this._relations = restored.relations;
    this._currentTick = restored.tick;
  }

  /**
   * Get the delta since the last tick advance.
   */
  getDelta(newEvents: EventEntry[]): StateDelta | null {
    if (!this._previousSnapshot) return null;
    return calculateDelta(this._previousSnapshot, this.snapshot(), newEvents);
  }

  // ─── Registered Actions ───────────────────────────────────────────────────

  /**
   * Get all registered action schemas (for exposing to agents).
   */
  getActionSchemas(): ActionSchema[] {
    return [...this._actionRegistry.values()];
  }

  /**
   * Get a specific action schema by ID.
   */
  getActionSchema(id: string): ActionSchema | undefined {
    return this._actionRegistry.get(id);
  }

  /**
   * Register a single action schema (outside of ontology loading).
   */
  registerAction(action: ActionSchema): void {
    this._actionRegistry.set(action.id, action);
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

  /**
   * Get a human-readable summary of the current state (useful for agent context).
   */
  getSummary(): string {
    const lines: string[] = [
      `=== Moriarty CSG State (Tick ${this._currentTick}) ===`,
      `Entities: ${this._entities.size}`,
      `Active Relations: ${this.getActiveRelations().length}`,
      `Total Events: ${this._eventLog.length}`,
      `Registered Actions: ${this._actionRegistry.size}`,
      ``,
    ];

    // Entity breakdown by type
    const byType = new Map<EntityType, number>();
    for (const entity of this._entities.values()) {
      byType.set(entity.type, (byType.get(entity.type) ?? 0) + 1);
    }
    lines.push(`Entity breakdown:`);
    for (const [type, count] of byType) {
      lines.push(`  ${type}: ${count}`);
    }

    return lines.join("\n");
  }
}
