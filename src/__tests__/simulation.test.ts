import { describe, it, expect, beforeEach } from "vitest";
import { CausalStateGraph } from "../runtime/csg/graph.js";
import { SimulationTickLoop } from "../runtime/simulation/tick.js";
import type { ActionSchema } from "../runtime/types.js";

describe("Simulation Tick Loop", () => {
  let csg: CausalStateGraph;

  beforeEach(() => {
    csg = new CausalStateGraph();
  });

  it("should step simulation ticks manually with deterministic state transitions", async () => {
    const actor = csg.addEntity({ type: "agent", name: "Operative" });
    const target = csg.addEntity({ type: "location", name: "Safehouse" });

    const moveSchema: ActionSchema = {
      id: "move_to",
      name: "Move To",
      description: "Relocate actor",
      actor_types: ["agent"],
      tick_cost: 1,
      preconditions: [],
      effects: [
        {
          type: "add_relation",
          params: { relation_type: "located_in" },
        },
      ],
    };
    csg.registerAction(moveSchema);

    const loop = new SimulationTickLoop(csg, {
      tickInterval: 10,
      maxTicks: 3,
      autoAdvance: false,
    });

    let processedTicks = 0;
    loop.registerAgentProcessor(async (_graph, tick) => {
      processedTicks++;
      return [
        {
          action_id: "move_to",
          actor_id: actor.id,
          target_ids: [target.id],
          params: {},
          tick_submitted: tick,
        },
      ];
    });

    const step1 = await loop.stepOnce();
    expect(step1.tick).toBe(0);
    expect(step1.results).toHaveLength(1);
    expect(step1.results[0].success).toBe(true);
    expect(csg.currentTick).toBe(1);
    expect(csg.hasRelation(actor.id, target.id, "located_in")).toBe(true);
    expect(processedTicks).toBe(1);
  });

  it("should trigger post-tick callbacks", async () => {
    const loop = new SimulationTickLoop(csg, {
      tickInterval: 10,
      maxTicks: 1,
      autoAdvance: false,
    });

    let callbackFired = false;
    loop.onPostTick((tick, _results, _events) => {
      callbackFired = true;
      expect(tick).toBe(0);
    });

    await loop.stepOnce();
    expect(callbackFired).toBe(true);
  });
});
