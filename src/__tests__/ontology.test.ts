import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadOntologyFromFile,
  loadOntologyFromString,
} from "../runtime/ontology/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Ontology Schema Engine", () => {
  it("should successfully load and validate base-ontology.yaml", () => {
    const schemaPath = resolve(__dirname, "../schemas/base-ontology.yaml");
    const ontology = loadOntologyFromFile(schemaPath);

    expect(ontology.name).toBe("moriarty-base");
    expect(ontology.version).toBe("1.0.0");
    expect(ontology.entity_types.length).toBeGreaterThanOrEqual(6);
    expect(ontology.actions.length).toBeGreaterThanOrEqual(8);

    const moveAction = ontology.actions.find((a) => a.id === "move_to");
    expect(moveAction).toBeDefined();
    expect(moveAction?.actor_types).toContain("agent");
    expect(moveAction?.effects.some((e) => e.type === "add_relation")).toBe(true);
  });

  it("should parse an in-memory ontology YAML string", () => {
    const yaml = `
version: "1.0.0"
name: "test-ontology"
description: "Minimal test ontology"
entity_types:
  - type: agent
    description: "Actor"
actions:
  - id: rest
    name: "Rest"
    description: "Recover stamina"
    actor_types: [agent]
    tick_cost: 2
    effects:
      - type: modify_property
        params:
          property: stamina
          delta: 10
`;
    const ontology = loadOntologyFromString(yaml);
    expect(ontology.name).toBe("test-ontology");
    expect(ontology.actions).toHaveLength(1);
    expect(ontology.actions[0].tick_cost).toBe(2);
  });

  it("should throw an error on invalid schema", () => {
    const invalidYaml = `
version: "1.0.0"
# Missing name
actions:
  - id: bad_action
    actor_types: [alien] # invalid entity type
`;
    expect(() => loadOntologyFromString(invalidYaml)).toThrow();
  });
});
