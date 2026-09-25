import { describe, it, expect, beforeEach } from "vitest";
import { CausalStateGraph } from "../runtime/csg/graph.js";
import {
  MoriartyPlanner,
  type CSGToActionSpace,
} from "../runtime/agent/planner.js";
import type { GoalFacts } from "goap-solver";

describe("Moriarty GOAP Planner", () => {
  let csg: CausalStateGraph;

  beforeEach(() => {
    csg = new CausalStateGraph();
  });

  it("should generate a multi-step plan to achieve a goal state", () => {
    const actor = csg.addEntity({ type: "agent", name: "Infiltrator" });
    const key = csg.addEntity({ type: "object", name: "Master Key" });
    const vault = csg.addEntity({ type: "location", name: "Vault" });

    const translator: CSGToActionSpace = {
      extractState: (_graph, _actorId): GoalFacts => {
        return {
          at_vault: false,
          has_key: false,
          vault_unlocked: false,
        };
      },
      getAvailableActions: (_graph, actorId) => [
        {
          name: "get_key",
          preconditions: { has_key: false },
          effects: { has_key: true },
          moriartyRequest: {
            action_id: "pick_up",
            actor_id: actorId,
            target_ids: [key.id],
            params: {},
          },
        },
        {
          name: "move_to_vault",
          preconditions: { at_vault: false },
          effects: { at_vault: true },
          moriartyRequest: {
            action_id: "move_to",
            actor_id: actorId,
            target_ids: [vault.id],
            params: {},
          },
        },
        {
          name: "unlock_vault",
          preconditions: { at_vault: true, has_key: true },
          effects: { vault_unlocked: true },
          moriartyRequest: {
            action_id: "unlock",
            actor_id: actorId,
            target_ids: [vault.id],
            params: { key_id: key.id },
          },
        },
      ],
    };

    const planner = new MoriartyPlanner(csg, translator);
    const plan = planner.plan(actor.id, { vault_unlocked: true });

    expect(plan).not.toBeNull();
    expect(plan).toHaveLength(3);
    expect(plan?.map((req) => req.action_id)).toEqual([
      "pick_up",
      "move_to",
      "unlock",
    ]);
  });

  it("should return null when a goal is unreachable", () => {
    const actor = csg.addEntity({ type: "agent", name: "Infiltrator" });

    const translator: CSGToActionSpace = {
      extractState: (): GoalFacts => ({ has_power: false }),
      getAvailableActions: () => [],
    };

    const planner = new MoriartyPlanner(csg, translator);
    const plan = planner.plan(actor.id, { has_power: true });
    expect(plan).toBeNull();
  });
});
