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

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CausalStateGraph } from "./csg/graph.js";
import { loadOntologyFromFile } from "./ontology/schema.js";
import { loadWorld } from "./world-loader.js";
import { SimulationTickLoop } from "./simulation/tick.js";
import { OrchestratorAgent } from "./agents/orchestrator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log("╔════════════════════════════════════════════════════╗");
  console.log("║         MORIARTY — Executable Ontology Engine      ║");
  console.log("║         Open-World Agent Harness v0.1.0            ║");
  console.log("╚════════════════════════════════════════════════════╝");
  console.log();

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

  // 4. Find the player agent
  const playerAgentId = idMap.get("player_agent");
  if (!playerAgentId) {
    console.error("[Boot] ERROR: Player agent not found in world definition!");
    process.exit(1);
  }

  // 5. Check for headless mode
  const isHeadless = process.argv.includes("--headless");
  const maxTicks = isHeadless ? 5 : 0;

  // 6. Check if Gemini API key is available
  const hasApiKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

  if (hasApiKey) {
    // 7a. Initialize the Gemini orchestrator agent
    const orchestrator = new OrchestratorAgent(csg, playerAgentId, {
      model: "gemini-3.8-flash",
      maxRoundsPerTick: 3,
    });

    // 8. Configure the simulation tick loop
    const tickLoop = new SimulationTickLoop(csg, {
      tickInterval: 2000,
      maxTicks,
      autoAdvance: isHeadless,
    });

    // Register the orchestrator as the agent processor
    tickLoop.registerAgentProcessor(async (_csg, tick) => {
      return await orchestrator.runTurn(tick);
    });

    // Log post-tick summaries
    tickLoop.onPostTick((tick, results, events) => {
      console.log(
        `\n─── Tick ${tick} Complete ─── ` +
          `Actions: ${results.length} | Events: ${events.length} | ` +
          `Entities: ${csg.entityCount} | Relations: ${csg.relationCount}`
      );
    });

    if (isHeadless) {
      console.log(`[Boot] Starting headless simulation (${maxTicks} ticks)...`);
      await tickLoop.start();
    } else {
      console.log("[Boot] Orchestrator ready. Run with --headless for auto mode.");
      console.log("[Boot] Stepping one tick for demonstration...\n");
      const result = await tickLoop.stepOnce();
      console.log(`\nFirst tick completed. ${result.results.length} actions processed.`);
    }
  } else {
    // 7b. No API key — run in demo mode without Gemini
    console.log("[Boot] No GEMINI_API_KEY found. Running in demo mode (no agent).");
    console.log("[Boot] Set GEMINI_API_KEY to enable the Gemini orchestrator agent.\n");

    // Demonstrate the engine with programmatic actions
    await runDemoMode(csg, idMap);
  }

  console.log("\n[Boot] Engine shutdown.");
}

/**
 * Demo mode — demonstrates the engine without Gemini API.
 */
async function runDemoMode(
  csg: CausalStateGraph,
  idMap: Map<string, string>
): Promise<void> {
  const playerId = idMap.get("player_agent")!;
  const mainLibraryId = idMap.get("main_library")!;
  const scholarId = idMap.get("scholar_meridia")!;
  const balconyId = idMap.get("upper_balcony")!;
  const keyId = idMap.get("crystal_key")!;

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
  csg.advanceTick();

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
  csg.advanceTick();

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
  csg.advanceTick();

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
  csg.advanceTick();

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
  csg.advanceTick();

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
