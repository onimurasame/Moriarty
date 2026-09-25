/**
 * CausalStateGraph — The central runtime data structure.
 *
 * A temporal, directed graph of entities, relations, and events.
 * This is the single source of truth for all world state in Moriarty.
 *
 * Backed by Graphology for advanced graph traversal and algorithms.
 */

import { v7 as uuidv7 } from "uuid";
import Graph from "graphology";
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
  StateDelta,
} from "../types.js";
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

export type TickCallback = (tick: number, events: EventEntry[]) => void;

export class CausalStateGraph {
  // ─── State ────────────────────────────────────────────────────────────────
  // Graphology instance: multi=true allows multiple edges between the same two nodes
  // @ts-expect-error - graphology types don't provide construct signature properly here
  private _graph = new Graph({ directed: true, multi: true });
  
  private _eventLog: EventEntry[] = [];
  private _currentTick: number = 0;
  private _schema: OntologySchema | null = null;
  private _actionRegistry: Map<string, ActionSchema> = new Map();
  private _tickCallbacks: TickCallback[] = [];
  private _previousSnapshot: WorldSnapshot | null = null;
  private _lastDelta: StateDelta | null = null;

  constructor() {
    this._previousSnapshot = this.snapshot();
  }

  // ─── Getters ──────────────────────────────────────────────────────────────

  get currentTick(): number {
    return this._currentTick;
  }

  get entityCount(): number {
    return this._graph.order;
  }

  get relationCount(): number {
    return this._graph.size;
  }

  get eventCount(): number {
    return this._eventLog.length;
  }

  get schema(): OntologySchema | null {
    return this._schema;
  }

  // ─── Schema & Initialization ──────────────────────────────────────────────

  loadSchema(schema: OntologySchema): void {
    this._schema = schema;
    this._actionRegistry.clear();
    for (const action of schema.actions) {
      this._actionRegistry.set(action.id, action);
    }
  }

  onTick(callback: TickCallback): void {
    this._tickCallbacks.push(callback);
  }

  // ─── Entity Operations ────────────────────────────────────────────────────

  addEntity(options: CreateEntityOptions): Entity {
    const entity = createEntity(this._currentTick, options);
    this._graph.addNode(entity.id, { entity });
    return entity;
  }

  getEntity(id: string): Entity | undefined {
    if (!this._graph.hasNode(id)) return undefined;
    return this._graph.getNodeAttribute(id, "entity") as Entity;
  }

  getAllEntities(): Entity[] {
    return this._graph.mapNodes((_, attr) => attr.entity as Entity);
  }

  getEntitiesByType(type: EntityType): Entity[] {
    return this.getAllEntities().filter((e) => e.type === type);
  }

  setProperty(entityId: string, key: string, value: PropertyValue): Entity {
    const entity = this.getEntity(entityId);
    if (!entity) throw new Error(`Entity not found: ${entityId}`);

    const updated = setEntityProperty(entity, key, value, this._currentTick);
    this._graph.setNodeAttribute(entityId, "entity", updated);
    return updated;
  }

  removeEntity(entityId: string): void {
    if (!this._graph.hasNode(entityId)) return;

    // Deactivate all incident relations
    this._graph.forEachEdge(entityId, (edge, attr) => {
      const relation = attr.relation as Relation;
      if (isRelationActive(relation, this._currentTick)) {
        this.deactivateRelation(edge);
      }
    });

    this._graph.dropNode(entityId);
  }

  // ─── Relation Operations ──────────────────────────────────────────────────

  addRelation(options: CreateRelationOptions): Relation {
    if (!this._graph.hasNode(options.source)) throw new Error(`Source entity not found: ${options.source}`);
    if (!this._graph.hasNode(options.target)) throw new Error(`Target entity not found: ${options.target}`);

    const relation = createRelation(this._currentTick, options);
    this._graph.addEdgeWithKey(relation.id, options.source, options.target, { relation });

    // Update entity relation refs
    const sourceEntity = this.getEntity(options.source)!;
    const targetEntity = this.getEntity(options.target)!;
    this._graph.setNodeAttribute(options.source, "entity", addRelationRef(sourceEntity, relation.id));
    this._graph.setNodeAttribute(options.target, "entity", addRelationRef(targetEntity, relation.id));

    return relation;
  }

  getRelation(id: string): Relation | undefined {
    if (!this._graph.hasEdge(id)) return undefined;
    return this._graph.getEdgeAttribute(id, "relation") as Relation;
  }

  getActiveRelations(): Relation[] {
    return this._graph.mapEdges((_, attr) => attr.relation as Relation)
      .filter(r => isRelationActive(r, this._currentTick));
  }

  deactivateRelation(relationId: string): void {
    const relation = this.getRelation(relationId);
    if (!relation) return;

    const deactivated = deactivateRelation(relation, this._currentTick);
    this._graph.setEdgeAttribute(relationId, "relation", deactivated);

    // Remove relation refs
    if (this._graph.hasNode(relation.source)) {
      const sourceEntity = this.getEntity(relation.source)!;
      this._graph.setNodeAttribute(relation.source, "entity", removeRelationRef(sourceEntity, relationId));
    }
    if (this._graph.hasNode(relation.target)) {
      const targetEntity = this.getEntity(relation.target)!;
      this._graph.setNodeAttribute(relation.target, "entity", removeRelationRef(targetEntity, relationId));
    }
  }

  hasRelation(sourceId: string, targetId: string, type: RelationType): boolean {
    if (!this._graph.hasNode(sourceId) || !this._graph.hasNode(targetId)) return false;
    
    // Graphology provides an easy way to check edges between source and target
    const edges = this._graph.edges(sourceId, targetId);
    for (const edge of edges) {
      const rel = this._graph.getEdgeAttribute(edge, "relation") as Relation;
      if (rel.type === type && isRelationActive(rel, this._currentTick)) {
        return true;
      }
    }
    return false;
  }

  getRelatedIds(sourceId: string, type: RelationType): string[] {
    if (!this._graph.hasNode(sourceId)) return [];
    
    const targets: string[] = [];
    this._graph.forEachOutEdge(sourceId, (edge, attr, source, target) => {
      const rel = attr.relation as Relation;
      if (rel.type === type && isRelationActive(rel, this._currentTick)) {
        targets.push(target);
      }
    });
    return targets;
  }

  // ─── Action Execution ─────────────────────────────────────────────────────

  applyAction(request: ActionRequest): ActionResult {
    const schema = this._actionRegistry.get(request.action_id);
    if (!schema) {
      return this.createFailureResult(request, `Unknown action: ${request.action_id}`);
    }

    const actor = this.getEntity(request.actor_id);
    if (!actor) {
      return this.createFailureResult(request, `Actor not found: ${request.actor_id}`);
    }

    if (!schema.actor_types.includes(actor.type)) {
      return this.createFailureResult(request, `Actor type "${actor.type}" cannot perform "${schema.name}"`);
    }

    const failedConditions = schema.preconditions.filter(cond => !this.evaluateCondition(cond, request));
    if (failedConditions.length > 0) {
      const eventId = this.recordEvent({
        action: request.action_id, actor: request.actor_id, targets: request.target_ids,
        preconditions_met: false, effects_applied: [],
      });
      return { ...this.createFailureResult(request, `Preconditions not met`), event_id: eventId, failed_conditions: failedConditions };
    }

    const appliedEffects: Effect[] = [];
    for (const effect of schema.effects) {
      try {
        this.applyEffect(effect, request);
        appliedEffects.push(effect);
      } catch (err) {
        console.error(`Effect application failed:`, err);
      }
    }

    const eventId = this.recordEvent({
      action: request.action_id, actor: request.actor_id, targets: request.target_ids,
      preconditions_met: true, effects_applied: appliedEffects,
    });

    return {
      success: true, action_id: request.action_id, actor_id: request.actor_id,
      tick: this._currentTick, event_id: eventId, effects_applied: appliedEffects,
    };
  }

  private createFailureResult(request: ActionRequest, reason: string): ActionResult {
    return {
      success: false, action_id: request.action_id, actor_id: request.actor_id,
      tick: this._currentTick, effects_applied: [], failure_reason: reason,
    };
  }

  // ─── Condition Evaluation ─────────────────────────────────────────────────

  private evaluateCondition(condition: { type: string; params: Record<string, unknown> }, request: ActionRequest): boolean {
    switch (condition.type) {
      case "property_check": {
        let entityId = condition.params.entity_id as string | undefined;
        if (!entityId) {
          if (condition.params.target === "actor") entityId = request.actor_id;
          else if (condition.params.target === "target") entityId = request.target_ids[0];
          else entityId = request.target_ids[0] ?? request.actor_id;
        }
        const entity = this.getEntity(entityId);
        if (!entity) return false;

        const prop = entity.properties.get(condition.params.property as string);
        if (!prop) return false;

        const operator = (condition.params.operator as string) ?? (condition.params.op as string) ?? "eq";
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
        if (prop.type === "boolean" && typeof expected === "boolean") return prop.value === expected;
        if (prop.type === "string" && typeof expected === "string") return prop.value === expected;
        return false;
      }

      case "relation_exists": {
        const source = (condition.params.source as string) ?? request.actor_id;
        const target = (condition.params.target as string) ?? request.target_ids[0];
        return this.hasRelation(source, target, condition.params.relation_type as RelationType);
      }

      case "relation_absent": {
        const source = (condition.params.source as string) ?? request.actor_id;
        const target = (condition.params.target as string) ?? request.target_ids[0];
        return !this.hasRelation(source, target, condition.params.relation_type as RelationType);
      }

      case "proximity": {
        const actor = this.getEntity(request.actor_id);
        const target = this.getEntity(request.target_ids[0] ?? "");
        if (!actor || !target) return false;
        
        const actorPos = getPosition(actor);
        const targetPos = getPosition(target);
        if (!actorPos || !targetPos) return false;
        
        const maxDistance = (condition.params.max_distance as number) ?? 5;
        return distance3D(actorPos, targetPos) <= maxDistance;
      }

      case "inventory_has": {
        const entity = this.getEntity(request.actor_id);
        if (!entity) return false;
        const inventoryComp = entity.components.get("inventory");
        if (!inventoryComp) return false;
        
        const itemId = condition.params.item_id as string;
        const items = inventoryComp.data["items"];
        if (!items || items.type !== "list") return false;
        
        return items.value.some((v) => v.type === "ref" && v.value === itemId);
      }

      case "entity_type_is": {
        const entityId = (condition.params.entity_id as string) ?? request.target_ids[0];
        const entity = this.getEntity(entityId ?? "");
        return entity?.type === (condition.params.expected_type as string);
      }

      default: return false;
    }
  }

  // ─── Effect Application ───────────────────────────────────────────────────

  private applyEffect(effect: Effect, request: ActionRequest): void {
    switch (effect.type) {
      case "set_property": {
        let entityId = effect.params.entity_id as string | undefined;
        if (!entityId) {
          if (effect.params.target === "target") entityId = request.target_ids[0];
          else if (effect.params.target === "actor") entityId = request.actor_id;
          else entityId = request.actor_id;
        }
        this.setProperty(entityId, effect.params.property as string, effect.params.value as PropertyValue);
        break;
      }

      case "modify_property": {
        let entityId = effect.params.entity_id as string | undefined;
        if (!entityId) {
          if (effect.params.target === "target") entityId = request.target_ids[0];
          else if (effect.params.target === "actor") entityId = request.actor_id;
          else entityId = request.actor_id;
        }
        const key = effect.params.property as string;
        const delta = (effect.params.delta as number) ?? (effect.params.value as number) ?? 0;
        
        const entity = this.getEntity(entityId);
        if (!entity) break;
        
        const current = entity.properties.get(key);
        if (!current || current.type !== "number") break;

        let newValue = current.value + delta;
        if (current.min !== undefined) newValue = Math.max(current.min, newValue);
        if (current.max !== undefined) newValue = Math.min(current.max, newValue);

        this.setProperty(entityId, key, { type: "number", value: newValue, min: current.min, max: current.max });
        break;
      }

      case "add_relation": {
        const source = (effect.params.source as string) ?? request.actor_id;
        const target = (effect.params.target as string) ?? request.target_ids[0];
        const relType = effect.params.relation_type as RelationType;
        this.addRelation({ type: relType, source, target });

        // Spatial synchronization: if moving into a location, update source position
        if (relType === "located_in") {
          const targetEntity = this.getEntity(target);
          if (targetEntity) {
            const targetPos = targetEntity.properties.get("position");
            if (targetPos && targetPos.type === "vector3") {
              this.setProperty(source, "position", {
                type: "vector3",
                value: { ...targetPos.value },
              });
            }
          }
        }
        break;
      }

      case "remove_relation": {
        const source = (effect.params.source as string) ?? request.actor_id;
        const target = (effect.params.target as string) ?? request.target_ids[0];
        const relType = effect.params.relation_type as RelationType;

        if (this._graph.hasNode(source) && this._graph.hasNode(target)) {
          const edges = this._graph.edges(source, target);
          for (const edge of edges) {
            const rel = this._graph.getEdgeAttribute(edge, "relation") as Relation;
            if (rel.type === relType && isRelationActive(rel, this._currentTick)) {
              this.deactivateRelation(edge);
              break;
            }
          }
        }
        break;
      }

      case "create_entity": {
        this.addEntity(effect.params as unknown as CreateEntityOptions);
        break;
      }

      case "destroy_entity": {
        const entityId = (effect.params.entity_id as string) ?? request.target_ids[0];
        this.removeEntity(entityId);
        break;
      }

      case "emit_event": {
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
    }
  }

  // ─── Event Log ────────────────────────────────────────────────────────────

  private recordEvent(params: {
    action: string; actor: string; targets: string[];
    preconditions_met: boolean; effects_applied: Effect[]; caused_by?: string;
  }): string {
    const entry: EventEntry = {
      id: uuidv7(), tick: this._currentTick,
      action: params.action, actor: params.actor, targets: params.targets,
      preconditions_met: params.preconditions_met, effects_applied: params.effects_applied,
      caused_by: params.caused_by, timestamp: Date.now(),
    };
    this._eventLog.push(entry);
    return entry.id;
  }

  getEventLog(): ReadonlyArray<EventEntry> { return this._eventLog; }
  getEventsAtTick(tick: number): EventEntry[] { return this._eventLog.filter((e) => e.tick === tick); }

  // ─── Query ────────────────────────────────────────────────────────────────

  query(q: GraphQuery): QueryResult {
    // Reconstruct Maps for executeQuery compatibility, or we could refactor executeQuery to take the graph instance directly.
    const entityMap = new Map(this.getAllEntities().map(e => [e.id, e]));
    const relationMap = new Map(this.getActiveRelations().map(r => [r.id, r]));
    return executeQuery(entityMap, relationMap, this._eventLog, this._currentTick, q);
  }

  // ─── Tick Management ──────────────────────────────────────────────────────

  advanceTick(): { tick: number; events: EventEntry[] } {
    const tickEvents = this.getEventsAtTick(this._currentTick);
    for (const cb of this._tickCallbacks) cb(this._currentTick, tickEvents);
    const currentSnap = this.snapshot();
    if (this._previousSnapshot) {
      this._lastDelta = calculateDelta(this._previousSnapshot, currentSnap, tickEvents);
    } else {
      this._lastDelta = null;
    }
    this._previousSnapshot = currentSnap;
    this._currentTick += 1;
    return { tick: this._currentTick, events: tickEvents };
  }

  // ─── Snapshot & Replay ────────────────────────────────────────────────────

  snapshot(): WorldSnapshot {
    const entityMap = new Map(this.getAllEntities().map(e => [e.id, e]));
    const relationMap = new Map(this.getActiveRelations().map(r => [r.id, r]));
    return createSnapshot(entityMap, relationMap, this._eventLog, this._currentTick);
  }

  restore(snapshot: WorldSnapshot): void {
    const restored = restoreFromSnapshot(snapshot);
    this._graph.clear();
    for (const [id, entity] of restored.entities) {
      this._graph.addNode(id, { entity });
    }
    for (const [id, relation] of restored.relations) {
      this._graph.addEdgeWithKey(id, relation.source, relation.target, { relation });
    }
    this._currentTick = restored.tick;
  }

  getDelta(newEvents?: EventEntry[]): StateDelta | null {
    if (this._lastDelta) return this._lastDelta;
    if (!this._previousSnapshot) return null;
    return calculateDelta(this._previousSnapshot, this.snapshot(), newEvents ?? []);
  }

  /**
   * Commits the current graph state as the baseline snapshot for future deltas.
   * Typically invoked after initial world loading or state hydration.
   */
  commitBaseline(): void {
    this._previousSnapshot = this.snapshot();
    this._lastDelta = null;
  }

  // ─── Registered Actions ───────────────────────────────────────────────────

  getActionSchemas(): ActionSchema[] { return [...this._actionRegistry.values()]; }
  getActionSchema(id: string): ActionSchema | undefined { return this._actionRegistry.get(id); }
  registerAction(action: ActionSchema): void { this._actionRegistry.set(action.id, action); }

  // ─── Utility ──────────────────────────────────────────────────────────────

  getSummary(): string {
    const lines = [
      `=== Moriarty CSG State (Tick ${this._currentTick}) ===`,
      `Entities: ${this.entityCount}`,
      `Active Relations: ${this.getActiveRelations().length}`,
      `Total Events: ${this.eventCount}`,
      `Registered Actions: ${this._actionRegistry.size}`,
      ``,
    ];

    const byType = new Map<EntityType, number>();
    this._graph.forEachNode((_, attr) => {
      const type = (attr.entity as Entity).type;
      byType.set(type, (byType.get(type) ?? 0) + 1);
    });
    
    lines.push(`Entity breakdown:`);
    for (const [type, count] of byType) lines.push(`  ${type}: ${count}`);

    return lines.join("\n");
  }
}
