/**
 * Moriarty Executable Ontology — Core Type Definitions
 *
 * This module defines the foundational types for the Causal State Graph (CSG).
 * All world state, entity definitions, relations, actions, and events
 * are expressed through these types.
 */

// ─── Entity Types ─────────────────────────────────────────────────────────────

/** Classification of entities within the ontology */
export type EntityType =
  | "agent"       // Gemini-driven actors
  | "npc"         // Rule-driven or scripted actors
  | "object"      // Interactive world objects
  | "location"    // Spatial regions / rooms / zones
  | "concept"     // Abstract ontological nodes (quest, faction, etc.)
  | "event";      // Reified events (for causal tracking)

/** A 3D spatial coordinate */
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

/** Discriminated union for typed property values */
export type PropertyValue =
  | { type: "number";  value: number;  min?: number; max?: number }
  | { type: "string";  value: string;  enum?: string[] }
  | { type: "boolean"; value: boolean }
  | { type: "vector3"; value: Vector3 }
  | { type: "ref";     value: string }   // Entity ID reference
  | { type: "list";    value: PropertyValue[] };

/** A component groups related properties under a typed schema */
export interface Component {
  type: string;                           // "inventory", "health", "dialogue", etc.
  schema: string;                         // Reference to component schema in ontology
  data: Record<string, PropertyValue>;
}

/** Metadata tracked for every entity */
export interface EntityMetadata {
  created_at: number;                     // Simulation tick
  created_by: string;                     // Entity ID of creator
  last_modified_at: number;
  version: number;                        // Optimistic concurrency
  tags: string[];
}

/** An Entity is any uniquely identifiable thing in the world */
export interface Entity {
  id: string;                             // UUID v7 (time-ordered)
  type: EntityType;
  name: string;                           // Human-readable label
  properties: Map<string, PropertyValue>;
  components: Map<string, Component>;
  relations: string[];                    // Relation IDs
  metadata: EntityMetadata;
}

// ─── Relation Types ───────────────────────────────────────────────────────────

/** Classification of relationships between entities */
export type RelationType =
  | "located_in"      // Spatial containment
  | "owns"            // Possession
  | "knows"           // Knowledge / awareness
  | "allied_with"     // Faction / social
  | "hostile_to"
  | "contains"        // Physical containment (chest contains item)
  | "depends_on"      // Causal dependency
  | "caused_by"       // Direct causation link
  | "blocks"          // One entity prevents another's action
  | "enables"         // One entity allows another's action
  | "custom";         // User-defined via ontology schema

/** A directed edge in the Causal State Graph */
export interface Relation {
  id: string;
  type: RelationType;
  source: string;                         // Entity ID
  target: string;                         // Entity ID
  properties: Map<string, PropertyValue>;
  causal_chain?: string[];                // IDs of events that established this
  valid_from: number;                     // Tick the relation became active
  valid_until: number | null;             // null = still active
}

// ─── Action Types ─────────────────────────────────────────────────────────────

/** Condition types for action preconditions */
export type ConditionType =
  | "property_check"
  | "relation_exists"
  | "relation_absent"
  | "proximity"
  | "inventory_has"
  | "entity_type_is"
  | "custom";

/** A precondition that must hold for an action to be valid */
export interface Condition {
  type: ConditionType;
  description?: string;                   // Human-readable for agent comprehension
  params: Record<string, unknown>;
}

/** Effect types applied when an action succeeds */
export type EffectType =
  | "set_property"
  | "add_relation"
  | "remove_relation"
  | "create_entity"
  | "destroy_entity"
  | "emit_event"
  | "modify_property"   // Increment/decrement numeric properties
  | "custom";

/** A state mutation applied on successful action execution */
export interface Effect {
  type: EffectType;
  description?: string;
  params: Record<string, unknown>;
}

/** Schema defining a possible action in the world */
export interface ActionSchema {
  id: string;
  name: string;                           // "pick_up", "attack", "speak_to", etc.
  description: string;                    // For agent comprehension
  preconditions: Condition[];             // ALL must be true
  effects: Effect[];                      // Applied on success
  tick_cost: number;                      // How many ticks this action takes
  stamina_cost?: number;
  actor_types: EntityType[];              // Who can perform this action
}

/** A request from an agent or system to perform an action */
export interface ActionRequest {
  action_id: string;                      // ActionSchema ID
  actor_id: string;                       // Entity performing the action
  target_ids: string[];                   // Target entities
  params: Record<string, unknown>;        // Additional parameters
  tick_submitted: number;                 // When the request was made
  already_applied?: boolean;              // True if already applied by agent tool
}

/** Result of attempting to perform an action */
export interface ActionResult {
  success: boolean;
  action_id: string;
  actor_id: string;
  tick: number;
  event_id?: string;                      // Created event entry ID
  effects_applied: Effect[];
  failure_reason?: string;                // Why preconditions failed
  failed_conditions?: Condition[];        // Which conditions weren't met
}

// ─── Event Log ────────────────────────────────────────────────────────────────

/** An immutable record in the event log */
export interface EventEntry {
  id: string;
  tick: number;
  action: string;                         // ActionSchema ID
  actor: string;                          // Entity ID
  targets: string[];                      // Entity IDs
  preconditions_met: boolean;
  effects_applied: Effect[];
  caused_by?: string;                     // Parent event ID (causal chain)
  timestamp: number;                      // Wall-clock for debugging
}

// ─── Graph Query Types ────────────────────────────────────────────────────────

/** Supported query operations on the CSG */
export type GraphQueryType =
  | "entities_by_type"
  | "entities_by_tag"
  | "entities_in_location"
  | "relations_of"
  | "path_between"
  | "entities_near"
  | "events_caused_by"
  | "events_at_tick"
  | "custom";

export interface GraphQuery {
  type: GraphQueryType;
  params: Record<string, unknown>;
}

export interface QueryResult {
  entities?: Entity[];
  relations?: Relation[];
  events?: EventEntry[];
  paths?: string[][];                     // Chains of entity IDs
  count?: number;
}

// ─── World Snapshot ───────────────────────────────────────────────────────────

/** A complete serializable snapshot of the world state */
export interface WorldSnapshot {
  tick: number;
  timestamp: number;
  entities: Record<string, SerializedEntity>;
  relations: Record<string, SerializedRelation>;
  event_count: number;
}

/** Entity in serializable form (Maps → Records) */
export interface SerializedEntity {
  id: string;
  type: EntityType;
  name: string;
  properties: Record<string, PropertyValue>;
  components: Record<string, Component>;
  relations: string[];
  metadata: EntityMetadata;
}

/** Relation in serializable form (Maps → Records) */
export interface SerializedRelation {
  id: string;
  type: RelationType;
  source: string;
  target: string;
  properties: Record<string, PropertyValue>;
  causal_chain?: string[];
  valid_from: number;
  valid_until: number | null;
}

// ─── Ontology Schema ──────────────────────────────────────────────────────────

/** The loaded ontology schema — defines what's possible in the world */
export interface OntologySchema {
  version: string;
  name: string;
  description: string;
  entity_types: EntityTypeSchema[];
  relation_types: RelationTypeSchema[];
  actions: ActionSchema[];
  component_schemas: ComponentSchema[];
}

export interface EntityTypeSchema {
  type: EntityType;
  description: string;
  required_properties: string[];
  optional_properties: string[];
  allowed_components: string[];
}

export interface RelationTypeSchema {
  type: RelationType;
  description: string;
  source_types: EntityType[];
  target_types: EntityType[];
  properties?: Record<string, PropertyValue>;
}

export interface ComponentSchema {
  type: string;
  description: string;
  properties: Record<string, {
    type: PropertyValue["type"];
    required: boolean;
    default?: unknown;
    description?: string;
  }>;
}

// ─── Bridge Protocol ──────────────────────────────────────────────────────────

/** State delta sent to UE per tick via MCP Tool calls */
export interface StateDelta {
  tick: number;
  entities_added: SerializedEntity[];
  entities_modified: Array<{ id: string; changes: Partial<SerializedEntity> }>;
  entities_removed: string[];
  relations_added: SerializedRelation[];
  relations_removed: string[];
  events: EventEntry[];
}
