import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CausalStateGraph } from "../runtime/csg/graph.js";
import { loadOntologyFromFile } from "../runtime/ontology/schema.js";
import { loadWorld } from "../runtime/world-loader.js";
import { SimulationTickLoop } from "../runtime/simulation/tick.js";
import { OrchestratorAgent } from "../runtime/agents/orchestrator.js";
import { MockProvider } from "../runtime/agents/provider.js";
import { UEBridgeClient } from "../runtime/bridge/mcp.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Ecosystem Integration: MockProvider & Unreal Engine Spatial Bridge", () => {
  let wss: WebSocketServer;
  const testPort = 9901;
  const receivedToolCalls: Array<{ name: string; arguments: any }> = [];

  beforeAll(async () => {
    wss = new WebSocketServer({ port: testPort });
    wss.on("connection", (ws: WebSocket) => {
      ws.on("message", (msg) => {
        const data = JSON.parse(msg.toString());
        if (data.method === "initialize") {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: data.id,
              result: {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "mock-unreal-mcp", version: "5.8.0" },
              },
            })
          );
        } else if (data.method === "tools/list") {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: data.id,
              result: {
                tools: [
                  { name: "spawn_actor" },
                  { name: "update_actor" },
                  { name: "destroy_actor" },
                ],
              },
            })
          );
        } else if (data.method === "tools/call") {
          receivedToolCalls.push(data.params);
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: data.id,
              result: { content: [{ type: "text", text: "OK" }] },
            })
          );
        }
      });
    });
  });

  afterAll(async () => {
    wss.close();
  });

  it("should execute agent turns via MockProvider and update Unreal Engine actor spatial coordinates", async () => {
    // 1. Initialize CSG, ontology, and world
    const csg = new CausalStateGraph();
    const ontologyPath = resolve(__dirname, "../schemas/base-ontology.yaml");
    const worldPath = resolve(__dirname, "../schemas/demo-world.yaml");

    const ontology = loadOntologyFromFile(ontologyPath);
    csg.loadSchema(ontology);
    const idMap = loadWorld(csg, worldPath);

    const playerUuid = idMap.get("player_agent")!;
    const libraryUuid = idMap.get("main_library")!;
    const balconyUuid = idMap.get("upper_balcony")!;

    // 2. Connect the UE MCP Bridge
    const ueBridge = new UEBridgeClient(csg, {
      serverUrl: `ws://127.0.0.1:${testPort}`,
      autoConnect: false,
    });
    const connected = await ueBridge.connect();
    expect(connected).toBe(true);

    // Initial sync spawns baseline actors in Unreal Engine
    await ueBridge.initialSync();
    const spawnCalls = receivedToolCalls.filter((c) => c.name === "spawn_actor");
    expect(spawnCalls.length).toBeGreaterThanOrEqual(1);
    const agentSpawn = spawnCalls.find((c) => (c.arguments.tags as string[])?.includes(playerUuid));
    expect(agentSpawn).toBeDefined();
    expect(agentSpawn?.arguments.location).toEqual({ x: 0, y: 0, z: 0 });

    // 3. Program MockProvider with distinct turn-by-turn steps
    const mockProvider = new MockProvider({
      script: [
        // Tick 0: Agent decides to move to the Main Library
        {
          content: "Initiating navigation to Main Library.",
          tool_calls: [
            {
              type: "function",
              function: {
                name: "perform_action",
                arguments: {
                  action_id: "move_to",
                  target_ids: [libraryUuid],
                },
              },
            },
          ],
        },
        // Tick 0 conclusion: reasoning without tool call concludes turn
        {
          content: "Arrived at Main Library. Concluding tick 0.",
        },
        // Tick 1: Agent decides to move from Main Library to Upper Balcony
        {
          content: "Climbing stairs to Upper Balcony.",
          tool_calls: [
            {
              type: "function",
              function: {
                name: "perform_action",
                arguments: {
                  action_id: "move_to",
                  target_ids: [balconyUuid],
                },
              },
            },
          ],
        },
        // Tick 1 conclusion:
        {
          content: "Arrived at Upper Balcony. Concluding tick 1.",
        },
      ],
    });

    const orchestrator = new OrchestratorAgent(csg, playerUuid, {
      provider: mockProvider,
      maxRoundsPerTick: 3,
    });

    // 4. Configure simulation loop
    const tickLoop = new SimulationTickLoop(csg, {
      tickInterval: 10,
      maxTicks: 2,
      autoAdvance: false,
    });

    tickLoop.registerAgentProcessor(async (_graph, tick) => {
      return await orchestrator.runTurn(tick);
    });

    tickLoop.onPostTick(async (_tick, _results, events) => {
      const delta = csg.getDelta(events);
      if (delta) {
        await ueBridge.pushStateDelta(delta);
      }
    });

    // Initial agent position check (Entrance Hall is at 0, 0, 0)
    const initialPos = csg.getEntity(playerUuid)?.properties.get("position")?.value as any;
    expect(initialPos).toEqual({ x: 0, y: 0, z: 0 });

    // Step Tick 0: Agent moves to Main Library (100, 0, 0)
    await tickLoop.stepOnce();

    const libraryPos = csg.getEntity(playerUuid)?.properties.get("position")?.value as any;
    expect(libraryPos).toEqual({ x: 100, y: 0, z: 0 });

    // Step Tick 1: Agent moves to Upper Balcony (100, 0, 50)
    await tickLoop.stepOnce();

    const balconyPos = csg.getEntity(playerUuid)?.properties.get("position")?.value as any;
    expect(balconyPos).toEqual({ x: 100, y: 0, z: 50 });

    // 5. Verify Unreal Engine MCP Tool Calls received
    expect(receivedToolCalls.length).toBeGreaterThanOrEqual(2);

    const updateCalls = receivedToolCalls.filter((c) => c.name === "update_actor");
    expect(updateCalls.length).toBeGreaterThanOrEqual(2);

    // First spatial update: Main Library at (100, 0, 0)
    const firstMoveCall = updateCalls.find((c) => c.arguments.id === playerUuid);
    expect(firstMoveCall).toBeDefined();
    expect(firstMoveCall?.arguments.location).toEqual({ x: 100, y: 0, z: 0 });

    // Second spatial update: Upper Balcony at (100, 0, 50)
    const secondMoveCall = updateCalls.filter((c) => c.arguments.id === playerUuid)[1];
    expect(secondMoveCall).toBeDefined();
    expect(secondMoveCall?.arguments.location).toEqual({ x: 100, y: 0, z: 50 });

    await ueBridge.close();
  });
});
