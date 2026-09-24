/**
 * Gemini Orchestrator Agent — Integrates the Gemini Interactions API
 * with the Causal State Graph via Function Calling.
 *
 * The orchestrator agent observes the world, reasons about it, and
 * takes actions through the defined tool interface. It uses stateful
 * conversations (previous_interaction_id) to maintain context across ticks.
 */

import { GoogleGenAI } from "@google/genai";
import type { CausalStateGraph } from "../csg/graph.js";
import type { ActionRequest } from "../types.js";
import {
  getAgentToolDeclarations,
  executeAgentTool,
} from "./tools.js";

export interface OrchestratorConfig {
  /** Gemini model to use (default: gemini-3.8-flash) */
  model: string;
  /** System instruction for the orchestrator */
  systemInstruction: string;
  /** Maximum function calling rounds per tick */
  maxRoundsPerTick: number;
  /** Whether to store interactions for conversation history */
  storeInteractions: boolean;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  model: "gemini-3.8-flash",
  systemInstruction: `You are the Moriarty Simulation Orchestrator — an AI agent inhabiting an open world.
You observe the world through your tools and take actions to pursue your goals.

Rules:
1. ALWAYS use observe_surroundings first to understand your environment
2. Use inspect_entity to learn more about specific things you notice
3. Use perform_action to interact with the world — actions are validated by the ontology
4. Use query_knowledge to recall what you already know
5. Think strategically about cause and effect — every action has consequences
6. If an action fails, understand WHY from the failure reason and adapt

You are curious, strategic, and methodical. Explore the world and build understanding.`,
  maxRoundsPerTick: 5,
  storeInteractions: true,
};

export class OrchestratorAgent {
  private client: GoogleGenAI;
  private config: OrchestratorConfig;
  private csg: CausalStateGraph;
  private agentEntityId: string;
  private previousInteractionId: string | null = null;

  constructor(
    csg: CausalStateGraph,
    agentEntityId: string,
    config?: Partial<OrchestratorConfig>
  ) {
    this.client = new GoogleGenAI({});
    this.csg = csg;
    this.agentEntityId = agentEntityId;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run one agent turn: observe → reason → act.
   *
   * Returns the action requests the agent wants to perform this tick.
   */
  async runTurn(tick: number): Promise<ActionRequest[]> {
    const agent = this.csg.getEntity(this.agentEntityId);
    if (!agent) {
      console.error(
        `[Orchestrator] Agent entity not found: ${this.agentEntityId}`
      );
      return [];
    }

    const collectedActions: ActionRequest[] = [];

    // Build the prompt for this tick
    const prompt = this.buildTurnPrompt(tick);

    try {
      // Initial interaction — the agent observes and decides
      let interaction = await this.client.interactions.create({
        model: this.config.model,
        input: prompt,
        system_instruction: this.config.systemInstruction,
        tools: [{ function_declarations: getAgentToolDeclarations() }],
        store: this.config.storeInteractions,
        ...(this.previousInteractionId
          ? { previous_interaction_id: this.previousInteractionId }
          : {}),
      });

      // Handle function calling loop
      let rounds = 0;
      while (rounds < this.config.maxRoundsPerTick) {
        // Check for function calls in the interaction steps
        const functionCalls = this.extractFunctionCalls(interaction);

        if (functionCalls.length === 0) {
          // No more function calls — agent is done thinking
          break;
        }

        // Execute each function call
        const functionResults: Array<{
          call_id: string;
          name: string;
          result: unknown;
        }> = [];

        for (const call of functionCalls) {
          console.log(
            `[Orchestrator] Tool call: ${call.name}(${JSON.stringify(call.arguments).slice(0, 100)}...)`
          );

          const result = executeAgentTool(
            this.csg,
            call.name,
            call.arguments as Record<string, unknown>
          );

          // Collect action requests from perform_action calls
          if (call.name === "perform_action" && result && typeof result === "object") {
            const actionResult = result as Record<string, unknown>;
            if (actionResult.success) {
              // Action was already applied by the tool handler
              collectedActions.push({
                action_id: (call.arguments as Record<string, unknown>)
                  .action_id as string,
                actor_id: this.agentEntityId,
                target_ids:
                  ((call.arguments as Record<string, unknown>)
                    .target_ids as string[]) ?? [],
                params:
                  ((call.arguments as Record<string, unknown>)
                    .params as Record<string, unknown>) ?? {},
                tick_submitted: tick,
              });
            }
          }

          functionResults.push({
            call_id: call.id,
            name: call.name,
            result,
          });
        }

        // Send function results back to the model
        interaction = await this.client.interactions.create({
          model: this.config.model,
          input: functionResults.map((fr) => ({
            type: "function_result" as const,
            call_id: fr.call_id,
            name: fr.name,
            result: JSON.stringify(fr.result),
          })),
          system_instruction: this.config.systemInstruction,
          tools: [{ function_declarations: getAgentToolDeclarations() }],
          store: this.config.storeInteractions,
          previous_interaction_id: interaction.id,
        });

        rounds++;
      }

      // Store interaction ID for conversation continuity
      this.previousInteractionId = interaction.id ?? null;

      // Log the agent's final reasoning
      const outputText = interaction.output_text;
      if (outputText) {
        console.log(`[Orchestrator] Agent reasoning: ${outputText.slice(0, 200)}...`);
      }
    } catch (err) {
      console.error(`[Orchestrator] Error during turn ${tick}:`, err);
    }

    return collectedActions;
  }

  /**
   * Build the context prompt for a new tick.
   */
  private buildTurnPrompt(tick: number): string {
    const agent = this.csg.getEntity(this.agentEntityId)!;
    const recentEvents = this.csg
      .getEventLog()
      .filter(
        (e) =>
          e.tick >= tick - 3 &&
          (e.actor === this.agentEntityId ||
            e.targets.includes(this.agentEntityId))
      )
      .map(
        (e) =>
          `  Tick ${e.tick}: ${e.action} (${e.preconditions_met ? "succeeded" : "failed"})`
      )
      .join("\n");

    return [
      `=== SIMULATION TICK ${tick} ===`,
      `You are "${agent.name}" (ID: ${agent.id}, type: ${agent.type}).`,
      ``,
      recentEvents
        ? `Recent events involving you:\n${recentEvents}`
        : "No recent events.",
      ``,
      `What do you want to do? Use your tools to observe, reason, and act.`,
    ].join("\n");
  }

  /**
   * Extract function call steps from an interaction response.
   */
  private extractFunctionCalls(
    interaction: { steps?: Array<{ type?: string; id?: string; name?: string; arguments?: unknown }> }
  ): Array<{ id: string; name: string; arguments: unknown }> {
    if (!interaction.steps) return [];

    return interaction.steps
      .filter((step) => step.type === "function_call")
      .map((step) => ({
        id: step.id ?? "",
        name: step.name ?? "",
        arguments: step.arguments ?? {},
      }));
  }

  /**
   * Reset conversation history (start fresh context).
   */
  resetConversation(): void {
    this.previousInteractionId = null;
  }
}
