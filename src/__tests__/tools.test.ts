import { describe, it, expect, beforeEach } from "vitest";
import { CausalStateGraph } from "../runtime/csg/graph.js";
import {
  getAgentToolDeclarations,
  executeAgentTool,
} from "../runtime/agents/tools.js";

describe("Agent Tool Interface", () => {
  let csg: CausalStateGraph;

  beforeEach(() => {
    csg = new CausalStateGraph();
  });

  it("should return complete tool declarations for the agent", () => {
    const decls = getAgentToolDeclarations();
    expect(decls.length).toBeGreaterThanOrEqual(6);

    const names = decls.map((d) => d.name);
    expect(names).toContain("observe_surroundings");
    expect(names).toContain("perform_action");
    expect(names).toContain("inspect_entity");
    expect(names).toContain("query_knowledge");
    expect(names).toContain("list_available_actions");
    expect(names).toContain("get_world_summary");
  });

  it("should execute observe_surroundings tool", () => {
    const agent = csg.addEntity({
      type: "agent",
      name: "Scout",
      position: { x: 0, y: 0, z: 0 },
    });
    const tree = csg.addEntity({
      type: "object",
      name: "Pine",
      position: { x: 5, y: 0, z: 0 },
    });

    const result = executeAgentTool(csg, "observe_surroundings", {
      agent_id: agent.id,
      radius: 20,
    }) as Record<string, unknown>;

    expect(result.count).toBe(1);
    expect((result.entities as any[])[0].id).toBe(tree.id);
  });

  it("should execute inspect_entity tool when entity is near", () => {
    const agent = csg.addEntity({
      type: "agent",
      name: "Investigator",
      position: { x: 0, y: 0, z: 0 },
    });
    const chest = csg.addEntity({
      type: "object",
      name: "Wooden Chest",
      position: { x: 2, y: 0, z: 0 },
      properties: { is_locked: { type: "boolean", value: true } },
    });

    const result = executeAgentTool(csg, "inspect_entity", {
      agent_id: agent.id,
      entity_id: chest.id,
    }) as { entity: { id: string; name: string; properties: Record<string, any> } };

    expect(result.entity).toBeDefined();
    expect(result.entity.id).toBe(chest.id);
    expect(result.entity.name).toBe("Wooden Chest");
    expect(result.entity.properties.is_locked.value).toBe(true);
  });

  it("should execute get_world_summary tool", () => {
    csg.addEntity({ type: "location", name: "Cave" });
    const summary = executeAgentTool(csg, "get_world_summary", {}) as {
      tick: number;
      summary: string;
      recent_events: any[];
    };

    expect(summary.tick).toBe(0);
    expect(summary.summary).toBeDefined();
    expect(typeof summary.summary).toBe("string");
    expect(summary.summary).toContain("location: 1");
  });

  it("should normalize and smooth malformed/stringified arguments from LLM outputs", () => {
    const loc = csg.addEntity({ type: "location", name: "Hall" });
    const agent = csg.addEntity({
      type: "agent",
      name: "Traveler",
      position: { x: 0, y: 0, z: 0 },
    });

    csg.registerAction({
      id: "move_to",
      name: "Move To",
      actor_types: ["agent"],
      preconditions: [],
      effects: [
        {
          type: "add_relation",
          params: {
            relation_type: "located_in",
            source: agent.id,
            target: loc.id,
          },
        },
      ],
      tick_cost: 1,
    });

    // Test with stringified JSON array, stringified radius, and stringified params
    const result = executeAgentTool(csg, "perform_action", {
      action_id: "move_to",
      agent_id: agent.id,
      target_ids: JSON.stringify([loc.id]),
      params: "{}",
    }) as any;

    expect(result.success).toBe(true);
    expect(result.normalized_request).toBeDefined();
    expect(result.normalized_request.target_ids).toEqual([loc.id]);
    expect(csg.hasRelation(agent.id, loc.id, "located_in")).toBe(true);

    // Test observe_surroundings with string radius
    const obs = executeAgentTool(csg, "observe_surroundings", {
      actor_id: agent.id,
      radius: "25",
      filter_types: JSON.stringify(["location"]),
    }) as any;

    expect(obs.radius).toBe(25);
    expect(obs.entities).toBeDefined();
  });
});
