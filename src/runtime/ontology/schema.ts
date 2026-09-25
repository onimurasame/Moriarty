/**
 * Ontology Schema Loader — Parse and validate YAML ontology definitions using Zod.
 *
 * Ontology schemas define the "rules of the world" — what entity types exist,
 * what relations are valid, what actions are possible, and what components
 * can be attached.
 */

import { readFileSync } from "node:fs";
import { parse as parseYAML } from "yaml";
import { z } from "zod";
import type { OntologySchema } from "../types.js";

// ─── Zod Schemas for Validation ───────────────────────────────────────────────

const EntityTypeZ = z.enum(["agent", "npc", "object", "location", "concept", "event"]);

const RelationTypeZ = z.enum([
  "located_in", "owns", "knows", "allied_with", "hostile_to",
  "contains", "depends_on", "caused_by", "blocks", "enables", "custom"
]);

const ConditionTypeZ = z.enum([
  "property_check", "relation_exists", "relation_absent", "proximity",
  "inventory_has", "entity_type_is", "custom"
]);

const EffectTypeZ = z.enum([
  "set_property", "add_relation", "remove_relation", "create_entity",
  "destroy_entity", "emit_event", "modify_property", "custom"
]);

const PropertyValueTypeZ = z.enum([
  "number", "string", "boolean", "vector3", "ref", "list"
]);

const ConditionZ = z.object({
  type: ConditionTypeZ,
  description: z.string().optional(),
  params: z.record(z.unknown()).default({}),
});

const EffectZ = z.object({
  type: EffectTypeZ,
  description: z.string().optional(),
  params: z.record(z.unknown()).default({}),
});

const ActionSchemaZ = z.object({
  id: z.string(),
  name: z.string().optional(), // Will default to id if not provided, handled in transform
  description: z.string().default(""),
  preconditions: z.array(ConditionZ).default([]),
  effects: z.array(EffectZ).default([]),
  tick_cost: z.number().default(1),
  stamina_cost: z.number().optional(),
  actor_types: z.array(EntityTypeZ).default(["agent", "npc"]),
}).transform(val => ({
  ...val,
  name: val.name ?? val.id
}));

const EntityTypeSchemaZ = z.object({
  type: EntityTypeZ,
  description: z.string().default(""),
  required_properties: z.array(z.string()).default([]),
  optional_properties: z.array(z.string()).default([]),
  allowed_components: z.array(z.string()).default([]),
});

const RelationTypeSchemaZ = z.object({
  type: RelationTypeZ,
  description: z.string().default(""),
  source_types: z.array(EntityTypeZ).default(EntityTypeZ.options),
  target_types: z.array(EntityTypeZ).default(EntityTypeZ.options),
  properties: z.record(z.any()).optional(), // Optional relation properties
});

const ComponentPropertySchemaZ = z.object({
  type: PropertyValueTypeZ,
  required: z.boolean().default(false),
  default: z.unknown().optional(),
  description: z.string().optional(),
});

const ComponentSchemaZ = z.object({
  type: z.string(),
  description: z.string().default(""),
  properties: z.record(ComponentPropertySchemaZ).default({}),
});

export const OntologySchemaZ = z.object({
  version: z.string(),
  name: z.string(),
  description: z.string().default(""),
  entity_types: z.array(EntityTypeSchemaZ).default([]),
  relation_types: z.array(RelationTypeSchemaZ).default([]),
  actions: z.array(ActionSchemaZ).default([]),
  component_schemas: z.array(ComponentSchemaZ).default([]),
});

// ─── Loader Functions ─────────────────────────────────────────────────────────

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
  const data = parseYAML(yamlContent);
  
  // Zod handles all validation, type coercion, and defaults!
  const parsedSchema = OntologySchemaZ.parse(data) as OntologySchema;

  // Cross-validate: ensure actions reference valid entity types
  // (We could do this with Zod refine(), but keeping it here is fine for clarity)
  for (const action of parsedSchema.actions) {
    for (const actorType of action.actor_types) {
      if (!EntityTypeZ.options.includes(actorType as any)) {
        throw new Error(
          `Action "${action.id}" references unknown actor type: ${actorType}`
        );
      }
    }
  }

  // Inject defaults for missing entity/relation types if they weren't fully specified
  // Though Zod's .default([]) handles omitting the arrays entirely.
  // We can also ensure all valid types are represented if we want, but let's stick to what's defined.

  return parsedSchema;
}
