/**
 * World Loader — Hydrates a CausalStateGraph from a demo-world YAML file.
 *
 * Reads the world definition and creates all entities, relations,
 * and spatial connections in the CSG.
 */

import { readFileSync } from "node:fs";
import { parse as parseYAML } from "yaml";
import { CausalStateGraph } from "./csg/graph.js";
import type {
  PropertyValue,
  Component,
  Vector3,
  EntityType,
} from "./types.js";

interface WorldDef {
  version: string;
  name: string;
  description: string;
  locations: Array<{
    id: string;
    name: string;
    description: string;
    ambient_description?: string;
    is_outdoor?: boolean;
    position?: Vector3;
  }>;
  connections: Array<{ from: string; to: string }>;
  npcs: Array<{
    id: string;
    name: string;
    description: string;
    location: string;
    position?: Vector3;
    health?: number;
    stamina?: number;
    components?: Record<string, Record<string, unknown>>;
  }>;
  objects: Array<{
    id: string;
    name: string;
    description: string;
    location: string;
    position?: Vector3;
    is_portable?: boolean;
    is_locked?: boolean;
    weight?: number;
  }>;
  agent: {
    id: string;
    name: string;
    description: string;
    location: string;
    position?: Vector3;
    health?: number;
    stamina?: number;
    components?: Record<string, Record<string, unknown>>;
  };
}

/**
 * Load a world definition from a YAML file and populate the CSG.
 * Returns a map from YAML IDs to generated UUIDs.
 */
export function loadWorld(
  csg: CausalStateGraph,
  filepath: string
): Map<string, string> {
  const raw = readFileSync(filepath, "utf-8");
  const worldDef = parseYAML(raw) as WorldDef;
  return hydrateWorld(csg, worldDef);
}

/**
 * Hydrate the CSG from a parsed world definition.
 */
export function hydrateWorld(
  csg: CausalStateGraph,
  worldDef: WorldDef
): Map<string, string> {
  // Map from YAML IDs → generated UUIDs
  const idMap = new Map<string, string>();

  console.log(`[WorldLoader] Loading world: "${worldDef.name}"`);

  // 1. Create locations
  for (const loc of worldDef.locations) {
    const properties: Record<string, PropertyValue> = {
      description: { type: "string", value: loc.description },
    };
    if (loc.ambient_description) {
      properties.ambient_description = {
        type: "string",
        value: loc.ambient_description,
      };
    }
    if (loc.is_outdoor !== undefined) {
      properties.is_outdoor = { type: "boolean", value: loc.is_outdoor };
    }

    const entity = csg.addEntity({
      type: "location",
      name: loc.name,
      properties,
      position: loc.position,
      tags: ["location"],
    });
    idMap.set(loc.id, entity.id);
    console.log(`  📍 Location: ${loc.name} → ${entity.id}`);
  }

  // 2. Create connections (bidirectional "enables" relations)
  for (const conn of worldDef.connections) {
    const fromId = idMap.get(conn.from);
    const toId = idMap.get(conn.to);
    if (fromId && toId) {
      csg.addRelation({ type: "enables", source: fromId, target: toId });
      csg.addRelation({ type: "enables", source: toId, target: fromId });
    }
  }

  // 3. Create NPCs
  for (const npc of worldDef.npcs) {
    const properties: Record<string, PropertyValue> = {
      description: { type: "string", value: npc.description },
    };
    if (npc.health !== undefined) {
      properties.health = { type: "number", value: npc.health, min: 0, max: 100 };
    }
    if (npc.stamina !== undefined) {
      properties.stamina = { type: "number", value: npc.stamina, min: 0, max: 100 };
    }

    const components: Record<string, Component> = {};
    if (npc.components) {
      for (const [compType, compData] of Object.entries(npc.components)) {
        components[compType] = {
          type: compType,
          schema: compType,
          data: convertToPropertyValues(compData),
        };
      }
    }

    const entity = csg.addEntity({
      type: "npc",
      name: npc.name,
      properties,
      components,
      position: npc.position,
      tags: ["npc", "actor"],
    });
    idMap.set(npc.id, entity.id);

    // Place NPC in their location
    const locationId = idMap.get(npc.location);
    if (locationId) {
      csg.addRelation({
        type: "located_in",
        source: entity.id,
        target: locationId,
      });
    }
    console.log(`  🧑 NPC: ${npc.name} → ${entity.id}`);
  }

  // 4. Create objects
  for (const obj of worldDef.objects) {
    const properties: Record<string, PropertyValue> = {
      description: { type: "string", value: obj.description },
    };
    if (obj.is_portable !== undefined) {
      properties.is_portable = { type: "boolean", value: obj.is_portable };
    }
    if (obj.is_locked !== undefined) {
      properties.is_locked = { type: "boolean", value: obj.is_locked };
    }
    if (obj.weight !== undefined) {
      properties.weight = { type: "number", value: obj.weight };
    }

    const entity = csg.addEntity({
      type: "object",
      name: obj.name,
      properties,
      position: obj.position,
      tags: ["object"],
    });
    idMap.set(obj.id, entity.id);

    // Place object in its location
    const locationId = idMap.get(obj.location);
    if (locationId) {
      csg.addRelation({
        type: "located_in",
        source: entity.id,
        target: locationId,
      });
    }
    console.log(`  📦 Object: ${obj.name} → ${entity.id}`);
  }

  // 5. Create player agent
  const agentDef = worldDef.agent;
  const agentProperties: Record<string, PropertyValue> = {
    description: { type: "string", value: agentDef.description },
  };
  if (agentDef.health !== undefined) {
    agentProperties.health = { type: "number", value: agentDef.health, min: 0, max: 100 };
  }
  if (agentDef.stamina !== undefined) {
    agentProperties.stamina = { type: "number", value: agentDef.stamina, min: 0, max: 100 };
  }

  const agentComponents: Record<string, Component> = {};
  if (agentDef.components) {
    for (const [compType, compData] of Object.entries(agentDef.components)) {
      agentComponents[compType] = {
        type: compType,
        schema: compType,
        data: convertToPropertyValues(compData),
      };
    }
  }

  const agentEntity = csg.addEntity({
    type: "agent",
    name: agentDef.name,
    properties: agentProperties,
    components: agentComponents,
    position: agentDef.position,
    tags: ["agent", "player", "actor"],
  });
  idMap.set(agentDef.id, agentEntity.id);

  // Place agent in starting location
  const startLocationId = idMap.get(agentDef.location);
  if (startLocationId) {
    csg.addRelation({
      type: "located_in",
      source: agentEntity.id,
      target: startLocationId,
    });
  }
  console.log(`  🤖 Agent: ${agentDef.name} → ${agentEntity.id}`);

  console.log(`[WorldLoader] World loaded: ${idMap.size} entities created.`);
  return idMap;
}

/**
 * Convert raw YAML component data to PropertyValue records.
 */
function convertToPropertyValues(
  data: Record<string, unknown>
): Record<string, PropertyValue> {
  const result: Record<string, PropertyValue> = {};

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "number") {
      result[key] = { type: "number", value };
    } else if (typeof value === "boolean") {
      result[key] = { type: "boolean", value };
    } else if (typeof value === "string") {
      result[key] = { type: "string", value };
    } else if (Array.isArray(value)) {
      result[key] = {
        type: "list",
        value: value.map((item) => {
          if (typeof item === "string") return { type: "string" as const, value: item };
          if (typeof item === "number") return { type: "number" as const, value: item };
          if (typeof item === "boolean") return { type: "boolean" as const, value: item };
          return { type: "string" as const, value: String(item) };
        }),
      };
    }
  }

  return result;
}
