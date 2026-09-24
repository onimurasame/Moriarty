/**
 * Ontology Schema Loader — Parse and validate YAML ontology definitions.
 *
 * Ontology schemas define the "rules of the world" — what entity types exist,
 * what relations are valid, what actions are possible, and what components
 * can be attached.
 */

import { readFileSync } from "node:fs";
import { parse as parseYAML } from "yaml";
import type {
  OntologySchema,
  EntityTypeSchema,
  RelationTypeSchema,
  ActionSchema,
  ComponentSchema,
  Condition,
  Effect,
  EntityType,
  RelationType,
} from "./types.js";

/** Valid entity types for schema validation */
const VALID_ENTITY_TYPES: EntityType[] = [
  "agent", "npc", "object", "location", "concept", "event",
];

/** Valid relation types for schema validation */
const VALID_RELATION_TYPES: RelationType[] = [
  "located_in", "owns", "knows", "allied_with", "hostile_to",
  "contains", "depends_on", "caused_by", "blocks", "enables", "custom",
];

/**
 * Load and validate an ontology schema from a YAML file.
 */
export function loadOntologyFromFile(filepath: string): OntologySchema {
  const raw = readFileSync(filepath, "utf-8");
  return loadOntologyFromString(raw);
}

/**
 * Load and validate an ontology schema from a YAML string.
 */
export function loadOntologyFromString(yamlContent: string): OntologySchema {
  const data = parseYAML(yamlContent) as Record<string, unknown>;
  return validateSchema(data);
}

/**
 * Validate and normalize raw YAML data into a typed OntologySchema.
 */
function validateSchema(data: Record<string, unknown>): OntologySchema {
  if (!data.version || typeof data.version !== "string") {
    throw new Error("Ontology schema must have a 'version' string");
  }
  if (!data.name || typeof data.name !== "string") {
    throw new Error("Ontology schema must have a 'name' string");
  }

  const schema: OntologySchema = {
    version: data.version as string,
    name: data.name as string,
    description: (data.description as string) ?? "",
    entity_types: parseEntityTypes(data.entity_types),
    relation_types: parseRelationTypes(data.relation_types),
    actions: parseActions(data.actions),
    component_schemas: parseComponentSchemas(data.component_schemas),
  };

  // Cross-validate: ensure actions reference valid entity types
  for (const action of schema.actions) {
    for (const actorType of action.actor_types) {
      if (!VALID_ENTITY_TYPES.includes(actorType)) {
        throw new Error(
          `Action "${action.id}" references unknown actor type: ${actorType}`
        );
      }
    }
  }

  return schema;
}

function parseEntityTypes(
  raw: unknown
): EntityTypeSchema[] {
  if (!Array.isArray(raw)) return getDefaultEntityTypes();
  return raw.map((item: Record<string, unknown>) => ({
    type: item.type as EntityType,
    description: (item.description as string) ?? "",
    required_properties: (item.required_properties as string[]) ?? [],
    optional_properties: (item.optional_properties as string[]) ?? [],
    allowed_components: (item.allowed_components as string[]) ?? [],
  }));
}

function parseRelationTypes(
  raw: unknown
): RelationTypeSchema[] {
  if (!Array.isArray(raw)) return getDefaultRelationTypes();
  return raw.map((item: Record<string, unknown>) => ({
    type: item.type as RelationType,
    description: (item.description as string) ?? "",
    source_types: (item.source_types as EntityType[]) ?? VALID_ENTITY_TYPES,
    target_types: (item.target_types as EntityType[]) ?? VALID_ENTITY_TYPES,
  }));
}

function parseActions(raw: unknown): ActionSchema[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: Record<string, unknown>) => ({
    id: item.id as string,
    name: (item.name as string) ?? item.id,
    description: (item.description as string) ?? "",
    preconditions: parseConditions(item.preconditions),
    effects: parseEffects(item.effects),
    tick_cost: (item.tick_cost as number) ?? 1,
    stamina_cost: item.stamina_cost as number | undefined,
    actor_types: (item.actor_types as EntityType[]) ?? ["agent", "npc"],
  }));
}

function parseConditions(raw: unknown): Condition[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: Record<string, unknown>) => ({
    type: item.type as Condition["type"],
    description: item.description as string | undefined,
    params: (item.params as Record<string, unknown>) ?? {},
  }));
}

function parseEffects(raw: unknown): Effect[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: Record<string, unknown>) => ({
    type: item.type as Effect["type"],
    description: item.description as string | undefined,
    params: (item.params as Record<string, unknown>) ?? {},
  }));
}

function parseComponentSchemas(raw: unknown): ComponentSchema[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: Record<string, unknown>) => ({
    type: item.type as string,
    description: (item.description as string) ?? "",
    properties: (item.properties as ComponentSchema["properties"]) ?? {},
  }));
}

// ─── Default Schemas ──────────────────────────────────────────────────────────

function getDefaultEntityTypes(): EntityTypeSchema[] {
  return VALID_ENTITY_TYPES.map((type) => ({
    type,
    description: `Default ${type} entity`,
    required_properties: [],
    optional_properties: [],
    allowed_components: [],
  }));
}

function getDefaultRelationTypes(): RelationTypeSchema[] {
  return VALID_RELATION_TYPES.map((type) => ({
    type,
    description: `Default ${type} relation`,
    source_types: VALID_ENTITY_TYPES,
    target_types: VALID_ENTITY_TYPES,
  }));
}
