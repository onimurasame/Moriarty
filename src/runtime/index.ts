/**
 * Moriarty Runtime — Engine Entry Point
 *
 * Initializes the Causal State Graph, loads the ontology and world,
 * configures the Gemini orchestrator agent, and starts the simulation loop.
 *
 * Usage:
 *   npx tsx runtime/index.ts              # Interactive mode
 *   npx tsx runtime/index.ts --headless   # Run N ticks without prompts
 */

import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CausalStateGraph } from "./csg/graph.js";
import { loadOntologyFromFile } from "./ontology/schema.js";
import { loadWorld } from "./world-loader.js";
import { SimulationTickLoop } from "./simulation/tick.js";
import { OrchestratorAgent } from "./agents/orchestrator.js";
import { UEBridgeClient } from "./bridge/mcp.js";
import {
  type LLMProvider,
  MockProvider,
  OllamaProvider,
  GeminiProvider,
} from "./agents/provider.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config();
dotenv.config({ path: resolve(__dirname, "../.env") });

async function main() {
  console.log("╔════════════════════════════════════════════════════╗");
  console.log("║         MORIARTY — Executable Ontology Engine      ║");
  console.log("║         Open-World Agent Harness v0.1.0            ║");
  console.log("╚════════════════════════════════════════════════════╝");
  console.log();

  // CLI Arguments parsing
  const args = process.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    const arg = args.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  const hasFlag = (name: string): boolean => args.includes(`--${name}`);

  const providerName = getArg("provider") ?? (hasFlag("ollama") ? "ollama" : hasFlag("gemini") ? "gemini" : "mock");
  const modelName = getArg("model");
  const isHeadless = hasFlag("headless");
  const isDemo = hasFlag("demo");
  const noUe = hasFlag("no-ue");
  const ueUrl = getArg("ue-url") ?? "http://127.0.0.1:8080/mcp";
  const ticksArg = getArg("ticks");
  const maxTicks = ticksArg ? parseInt(ticksArg, 10) : isHeadless ? 5 : 0;

  // 1. Initialize the Causal State Graph
  const csg = new CausalStateGraph();
  console.log("[Boot] Causal State Graph initialized.");

  // 2. Load the base ontology schema
  const ontologyPath = resolve(__dirname, "../schemas/base-ontology.yaml");
  const schema = loadOntologyFromFile(ontologyPath);
  csg.loadSchema(schema);
  console.log(
    `[Boot] Ontology loaded: "${schema.name}" v${schema.version} ` +
      `(${schema.actions.length} actions, ${schema.entity_types.length} entity types)`
  );

  // 3. Load the demo world
  const worldPath = resolve(__dirname, "../schemas/demo-world.yaml");
  const idMap = loadWorld(csg, worldPath);
  console.log();
  console.log(csg.getSummary());
  console.log();

  // 3.5. Initialize UE Bridge
  let ueBridge: UEBridgeClient | null = null;
  if (!noUe) {
    ueBridge = new UEBridgeClient(csg, { serverUrl: ueUrl, autoConnect: true });
    // Attempt initial sync after a short delay for connection handshake
    setTimeout(() => {
      if (ueBridge?.isConnected) {
        ueBridge.initialSync().catch((err) => {
          console.warn("[UE Bridge] Initial sync notice:", err?.message ?? err);
        });
      }
    }, 400);
  }

  // 4. Find the player agent
  const playerAgentId = idMap.get("player_agent");
  if (!playerAgentId) {
    console.error("[Boot] ERROR: Player agent not found in world definition!");
    process.exit(1);
  }

  if (isDemo) {
    // Programmatic demo mode
    console.log("[Boot] Running in programmatic demo mode.\n");
    await runDemoMode(csg, idMap, ueBridge);
  } else {
    // Configure LLM Provider
    let provider: LLMProvider;
    if (providerName === "ollama") {
      const model = modelName ?? "llama3.2:1b";
      console.log(`[Boot] Configured OllamaProvider (model: ${model})`);
      provider = new OllamaProvider(model);
    } else if (providerName === "gemini") {
      const model = modelName ?? "gemini-3.8-flash";
      console.log(`[Boot] Configured GeminiProvider (model: ${model})`);
      provider = new GeminiProvider(model);
    } else {
      console.log("[Boot] Configured MockProvider (scripted narrative sequence + heuristic fallback)");
      const libraryId = idMap.get("main_library")!;
      const scholarId = idMap.get("scholar_meridia")!;
      const balconyId = idMap.get("upper_balcony")!;
      const keyId = idMap.get("crystal_key")!;

      provider = new MockProvider({
        script: [
          // Tick 0: Navigate to Main Library
          {
            content: "Agent objective: Navigate to the Main Library to investigate clues.",
            tool_calls: [
              {
                type: "function",
                function: {
                  name: "perform_action",
                  arguments: { action_id: "move_to", target_ids: [libraryId] },
                },
              },
            ],
          },
          { content: "Arrived at Main Library. Tick 0 concluded." },

          // Tick 1: Examine Scholar Meridia
          {
            content: "Agent objective: Examine Scholar Meridia in the library.",
            tool_calls: [
              {
                type: "function",
                function: {
                  name: "perform_action",
                  arguments: { action_id: "examine", target_ids: [scholarId] },
                },
              },
            ],
          },
          { content: "Examined Scholar Meridia. Knowledge acquired. Tick 1 concluded." },

          // Tick 2: Speak to Scholar Meridia
          {
            content: "Agent objective: Inquire with Scholar Meridia.",
            tool_calls: [
              {
                type: "function",
                function: {
                  name: "perform_action",
                  arguments: { action_id: "speak_to", target_ids: [scholarId] },
                },
              },
            ],
          },
          { content: "Scholar Meridia dialogue complete. Tick 2 concluded." },

          // Tick 3: Move to Upper Balcony
          {
            content: "Agent objective: Ascend stairs to the Upper Balcony.",
            tool_calls: [
              {
                type: "function",
                function: {
                  name: "perform_action",
                  arguments: { action_id: "move_to", target_ids: [balconyId] },
                },
              },
            ],
          },
          { content: "Arrived at Upper Balcony. Tick 3 concluded." },

          // Tick 4: Take the Crystal Key
          {
            content: "Agent objective: Retrieve the Crystal Key resting on the balcony.",
            tool_calls: [
              {
                type: "function",
                function: {
                  name: "perform_action",
                  arguments: { action_id: "take", target_ids: [keyId] },
                },
              },
            ],
          },
          { content: "Crystal Key secured in inventory. Tick 4 concluded." },
        ],
        fallbackHeuristic: true,
      });
    }

    const orchestrator = new OrchestratorAgent(csg, playerAgentId, {
      provider,
      maxRoundsPerTick: 3,
    });

    // Configure simulation tick loop
    const tickLoop = new SimulationTickLoop(csg, {
      tickInterval: 1000,
      maxTicks,
      autoAdvance: isHeadless,
    });

    // Register orchestrator as agent processor
    tickLoop.registerAgentProcessor(async (_csg, tick) => {
      return await orchestrator.runTurn(tick);
    });

    // Log post-tick summaries and push state deltas
    tickLoop.onPostTick((tick, results, events) => {
      console.log(
        `\n─── Tick ${tick} Complete ─── ` +
          `Actions: ${results.length} | Events: ${events.length} | ` +
          `Entities: ${csg.entityCount} | Relations: ${csg.relationCount}`
      );
      const delta = csg.getDelta(events);
      if (delta && ueBridge) {
        ueBridge.pushStateDelta(delta).catch((err) => {
          console.warn("[UE Bridge] State delta push warning:", err?.message ?? err);
        });
      }
    });

    if (isHeadless) {
      console.log(`[Boot] Starting headless simulation (${maxTicks} ticks, provider: ${providerName})...`);
      await tickLoop.start();
    } else {
      console.log(`[Boot] Agent ready (${providerName}). Run with --headless for automatic execution.`);
      console.log("[Boot] Stepping tick 0 for demonstration...\n");
      const result = await tickLoop.stepOnce();
      console.log(`\nInitial tick completed. ${result.results.length} actions processed.`);
    }
  }

  if (ueBridge) {
    await ueBridge.close();
  }
  console.log("\n[Boot] Engine shutdown.");
}

/**
 * Demo mode — demonstrates the engine without Gemini API.
 */
async function runDemoMode(
  csg: CausalStateGraph,
  idMap: Map<string, string>,
  ueBridge: UEBridgeClient
): Promise<void> {
  const playerId = idMap.get("player_agent")!;
  const mainLibraryId = idMap.get("main_library")!;
  const scholarId = idMap.get("scholar_meridia")!;
  const balconyId = idMap.get("upper_balcony")!;
  const keyId = idMap.get("crystal_key")!;

  const sendDelta = async (events: any[]) => {
    const delta = csg.getDelta(events);
    if (delta) await ueBridge.pushStateDelta(delta).catch(console.error);
  };

  console.log("=== Demo Mode: Programmatic Action Sequence ===\n");

  // Turn 1: Move to Main Library
  console.log("▶ Action: Move to Main Library");
  let result = csg.applyAction({
    action_id: "move_to",
    actor_id: playerId,
    target_ids: [mainLibraryId],
    params: {},
    tick_submitted: csg.currentTick,
  });
  console.log(`  Result: ${result.success ? "✓ Success" : "✗ Failed: " + result.failure_reason}`);
  await sendDelta(csg.advanceTick().events);

  // Turn 2: Examine the Scholar
  console.log("\n▶ Action: Examine Scholar Meridia");
  result = csg.applyAction({
    action_id: "examine",
    actor_id: playerId,
    target_ids: [scholarId],
    params: {},
    tick_submitted: csg.currentTick,
  });
  console.log(`  Result: ${result.success ? "✓ Success" : "✗ Failed: " + result.failure_reason}`);
  console.log(`  → Player now knows about the scholar`);
  await sendDelta(csg.advanceTick().events);

  // Turn 3: Speak to the Scholar
  console.log("\n▶ Action: Speak to Scholar Meridia");
  result = csg.applyAction({
    action_id: "speak_to",
    actor_id: playerId,
    target_ids: [scholarId],
    params: {},
    tick_submitted: csg.currentTick,
  });
  console.log(`  Result: ${result.success ? "✓ Success" : "✗ Failed: " + result.failure_reason}`);
  await sendDelta(csg.advanceTick().events);

  // Turn 4: Move to Upper Balcony
  console.log("\n▶ Action: Move to Upper Balcony");
  result = csg.applyAction({
    action_id: "move_to",
    actor_id: playerId,
    target_ids: [balconyId],
    params: {},
    tick_submitted: csg.currentTick,
  });
  console.log(`  Result: ${result.success ? "✓ Success" : "✗ Failed: " + result.failure_reason}`);
  await sendDelta(csg.advanceTick().events);

  // Turn 5: Pick up Crystal Key
  console.log("\n▶ Action: Pick up Crystal Key");
  result = csg.applyAction({
    action_id: "pick_up",
    actor_id: playerId,
    target_ids: [keyId],
    params: {},
    tick_submitted: csg.currentTick,
  });
  console.log(`  Result: ${result.success ? "✓ Success" : "✗ Failed: " + result.failure_reason}`);
  await sendDelta(csg.advanceTick().events);

  // Final state
  console.log("\n=== Final State ===\n");
  console.log(csg.getSummary());

  console.log(`\nEvent Log (${csg.eventCount} events):`);
  for (const event of csg.getEventLog()) {
    const actor = csg.getEntity(event.actor)?.name ?? event.actor;
    const status = event.preconditions_met ? "✓" : "✗";
    console.log(`  [Tick ${event.tick}] ${status} ${event.action} by ${actor}`);
  }
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
