import { describe, it, expect, beforeEach } from "vitest";
import { CausalStateGraph } from "../runtime/csg/graph.js";
import type { ActionSchema } from "../runtime/types.js";

describe("CausalStateGraph Core Operations", () => {
  let csg: CausalStateGraph;

  beforeEach(() => {
    csg = new CausalStateGraph();
  });

  it("should create and retrieve entities with typed properties", () => {
    const entity = csg.addEntity({
      type: "object",
      name: "Brass Key",
      properties: {
        weight: { type: "number", value: 1.5 },
        is_metallic: { type: "boolean", value: true },
      },
      tags: ["key", "item"],
    });

    expect(entity.id).toBeDefined();
    expect(entity.name).toBe("Brass Key");
    expect(entity.type).toBe("object");

    const retrieved = csg.getEntity(entity.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe("Brass Key");
    expect(retrieved?.properties.get("weight")?.value).toBe(1.5);
    expect(retrieved?.metadata.tags).toContain("key");
  });

  it("should update entity properties and increment version counter", () => {
    const entity = csg.addEntity({
      type: "agent",
      name: "Explorer",
      properties: {
        health: { type: "number", value: 100 },
      },
    });

    const initialVersion = entity.metadata.version;
    const updated = csg.setProperty(entity.id, "health", {
      type: "number",
      value: 85,
    });

    expect(updated).toBeDefined();
    const fetched = csg.getEntity(entity.id);
    expect(fetched?.properties.get("health")?.value).toBe(85);
    expect(fetched?.metadata.version).toBeGreaterThan(initialVersion);
  });

  it("should create, query, and deactivate directed relations", () => {
    const room = csg.addEntity({ type: "location", name: "Antechamber" });
    const chest = csg.addEntity({ type: "object", name: "Iron Chest" });

    const rel = csg.addRelation({
      type: "located_in",
      source: chest.id,
      target: room.id,
    });

    expect(rel.id).toBeDefined();
    expect(rel.valid_until).toBeNull();
    expect(csg.hasRelation(chest.id, room.id, "located_in")).toBe(true);

    const activeRelations = csg.getActiveRelations();
    expect(activeRelations).toHaveLength(1);
    expect(activeRelations[0].source).toBe(chest.id);
    expect(activeRelations[0].target).toBe(room.id);

    // Deactivate relation
    csg.deactivateRelation(rel.id);
    expect(csg.getActiveRelations()).toHaveLength(0);
    expect(csg.hasRelation(chest.id, room.id, "located_in")).toBe(false);

    const retired = csg.getRelation(rel.id);
    expect(retired?.valid_until).toBe(csg.currentTick);
  });

  it("should execute an action when preconditions are satisfied and record event", () => {
    const actor = csg.addEntity({
      type: "agent",
      name: "Hero",
      properties: { energy: { type: "number", value: 20 } },
    });
    const target = csg.addEntity({
      type: "object",
      name: "Torch",
      properties: { lit: { type: "boolean", value: false } },
    });

    const lightTorchSchema: ActionSchema = {
      id: "light_torch",
      name: "Light Torch",
      description: "Ignites a torch",
      actor_types: ["agent"],
      tick_cost: 1,
      preconditions: [
        {
          type: "property_check",
          params: { target: "actor", property: "energy", op: "gte", value: 10 },
        },
        {
          type: "property_check",
          params: { target: "target", property: "lit", op: "eq", value: false },
        },
      ],
      effects: [
        {
          type: "set_property",
          params: { target: "target", property: "lit", value: { type: "boolean", value: true } },
        },
        {
          type: "modify_property",
          params: { target: "actor", property: "energy", op: "add", value: -5 },
        },
      ],
    };

    csg.registerAction(lightTorchSchema);

    const result = csg.applyAction({
      action_id: "light_torch",
      actor_id: actor.id,
      target_ids: [target.id],
      params: {},
      tick_submitted: csg.currentTick,
    });

    expect(result.success).toBe(true);
    expect(result.effects_applied).toHaveLength(2);

    // Verify entity state changes
    expect(csg.getEntity(target.id)?.properties.get("lit")?.value).toBe(true);
    expect(csg.getEntity(actor.id)?.properties.get("energy")?.value).toBe(15);

    // Verify event logging
    const events = csg.getEventsAtTick(csg.currentTick);
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("light_torch");
    expect(events[0].actor).toBe(actor.id);
  });

  it("should reject action execution when preconditions fail", () => {
    const actor = csg.addEntity({
      type: "agent",
      name: "Weakling",
      properties: { energy: { type: "number", value: 5 } },
    });
    const target = csg.addEntity({
      type: "object",
      name: "Torch",
      properties: { lit: { type: "boolean", value: false } },
    });

    const lightTorchSchema: ActionSchema = {
      id: "light_torch_strict",
      name: "Light Torch Strict",
      description: "Requires 10 energy",
      actor_types: ["agent"],
      tick_cost: 1,
      preconditions: [
        {
          type: "property_check",
          params: { target: "actor", property: "energy", op: "gte", value: 10 },
        },
      ],
      effects: [],
    };

    csg.registerAction(lightTorchSchema);

    const result = csg.applyAction({
      action_id: "light_torch_strict",
      actor_id: actor.id,
      target_ids: [target.id],
      params: {},
      tick_submitted: csg.currentTick,
    });

    expect(result.success).toBe(false);
    expect(result.failure_reason).toBeDefined();
    expect(result.failed_conditions).toHaveLength(1);
  });

  it("should take snapshot and calculate delta correctly across ticks", () => {
    const loc = csg.addEntity({ type: "location", name: "Hall" });
    const item = csg.addEntity({ type: "object", name: "Coin" });

    // Tick 0 snapshot
    csg.advanceTick();

    // Mutations in Tick 1
    const player = csg.addEntity({ type: "agent", name: "Rogue" });
    csg.setProperty(item.id, "weight", { type: "number", value: 0.1 });
    csg.addRelation({
      type: "located_in",
      source: player.id,
      target: loc.id,
    });

    const { events } = csg.advanceTick();
    const delta = csg.getDelta(events);

    expect(delta).not.toBeNull();
    expect(delta?.entities_added.some((e) => e.name === "Rogue")).toBe(true);
    expect(delta?.entities_modified.some((m) => m.id === item.id)).toBe(true);
    expect(delta?.relations_added).toHaveLength(1);
  });

  it("should restore exact state from a serialized snapshot", () => {
    const loc = csg.addEntity({ type: "location", name: "Sanctum" });
    const npc = csg.addEntity({ type: "npc", name: "Priest" });
    csg.addRelation({ type: "located_in", source: npc.id, target: loc.id });

    const snap = csg.snapshot();

    // Create a new fresh CSG instance and restore
    const restoredCsg = new CausalStateGraph();
    restoredCsg.restore(snap);

    expect(restoredCsg.entityCount).toBe(2);
    expect(restoredCsg.getEntity(loc.id)?.name).toBe("Sanctum");
    expect(restoredCsg.getEntity(npc.id)?.name).toBe("Priest");
    expect(restoredCsg.getActiveRelations()).toHaveLength(1);
  });
});
