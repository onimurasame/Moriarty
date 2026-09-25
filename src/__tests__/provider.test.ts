import { describe, it, expect, beforeEach } from "vitest";
import { CausalStateGraph } from "../runtime/csg/graph.js";
import {
  MockProvider,
  type LLMToolDeclaration,
} from "../runtime/agents/provider.js";
import { OrchestratorAgent } from "../runtime/agents/orchestrator.js";

describe("LLM Provider Abstraction & MockProvider", () => {
  let csg: CausalStateGraph;

  beforeEach(() => {
    csg = new CausalStateGraph();
  });

  it("should process scripted tool calls and responses in MockProvider", async () => {
    const mock = new MockProvider({
      script: [
        {
          content: "I will inspect the surroundings.",
          tool_calls: [
            {
              type: "function",
              function: {
                name: "observe_surroundings",
                arguments: { radius: 30 },
              },
            },
          ],
        },
        {
          content: "I now understand the environment.",
        },
      ],
    });

    const dummyTools: LLMToolDeclaration[] = [
      {
        name: "observe_surroundings",
        description: "Test tool",
        parameters: {},
      },
    ];

    const turn1 = await mock.chat([{ role: "user", content: "Tick 0 start" }], dummyTools);
    expect(turn1.content).toBe("I will inspect the surroundings.");
    expect(turn1.tool_calls).toHaveLength(1);
    expect(turn1.tool_calls?.[0].function.name).toBe("observe_surroundings");

    const turn2 = await mock.chat(
      [
        { role: "user", content: "Tick 0 start" },
        { role: "assistant", content: turn1.content, tool_calls: turn1.tool_calls },
        { role: "tool", content: JSON.stringify({ count: 2 }) },
      ],
      dummyTools
    );
    expect(turn2.content).toBe("I now understand the environment.");
    expect(turn2.tool_calls).toBeUndefined();
    expect(mock.totalCalls).toBe(2);
  });

  it("should execute turn in OrchestratorAgent using MockProvider", async () => {
    const agent = csg.addEntity({
      type: "agent",
      name: "Autonomous Investigator",
      position: { x: 0, y: 0, z: 0 },
    });
    const targetRoom = csg.addEntity({
      type: "location",
      name: "Archive",
      position: { x: 50, y: 0, z: 0 },
    });

    // Register a valid action
    csg.registerAction({
      id: "move_to",
      name: "Move To",
      description: "Move to a room",
      actor_types: ["agent"],
      tick_cost: 1,
      preconditions: [],
      effects: [
        {
          type: "add_relation",
          params: { relation_type: "located_in" },
        },
      ],
    });

    const mock = new MockProvider({
      script: [
        {
          content: "Moving toward the Archive.",
          tool_calls: [
            {
              type: "function",
              function: {
                name: "perform_action",
                arguments: {
                  action_id: "move_to",
                  target_ids: [targetRoom.id],
                },
              },
            },
          ],
        },
      ],
    });

    const orchestrator = new OrchestratorAgent(csg, agent.id, {
      provider: mock,
      maxRoundsPerTick: 3,
    });

    const actions = await orchestrator.runTurn(0);
    expect(actions).toHaveLength(1);
    expect(actions[0].action_id).toBe("move_to");
    expect(actions[0].actor_id).toBe(agent.id);
    expect(actions[0].target_ids).toContain(targetRoom.id);
  });
});
