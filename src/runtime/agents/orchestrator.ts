/**
 * Moriarty Orchestrator Agent — LLM-driven autonomous agent
 * integrated with the Causal State Graph via Function Calling.
 *
 * Employs the LLMProvider abstraction (MockProvider, OllamaProvider, GeminiProvider)
 * to observe, reason, and act across discrete simulation ticks.
 */

import type { CausalStateGraph } from "../csg/graph.js";
import type { ActionRequest } from "../types.js";
import {
  getAgentToolDeclarations,
  executeAgentTool,
} from "./tools.js";
import {
  type LLMProvider,
  type LLMMessage,
  MockProvider,
} from "./provider.js";

export interface OrchestratorConfig {
  /** LLM provider instance (MockProvider, OllamaProvider, GeminiProvider) */
  provider?: LLMProvider;
  /** System instruction for the orchestrator */
  systemInstruction: string;
  /** Maximum function calling rounds per tick */
  maxRoundsPerTick: number;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
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
};

export class OrchestratorAgent {
  private provider: LLMProvider;
  private config: OrchestratorConfig;
  private csg: CausalStateGraph;
  private agentEntityId: string;
  private conversationHistory: LLMMessage[] = [];

  constructor(
    csg: CausalStateGraph,
    agentEntityId: string,
    config?: Partial<OrchestratorConfig>
  ) {
    this.csg = csg;
    this.agentEntityId = agentEntityId;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.provider = this.config.provider ?? new MockProvider({ fallbackHeuristic: true });
  }

  get currentProvider(): LLMProvider {
    return this.provider;
  }

  setProvider(provider: LLMProvider): void {
    this.provider = provider;
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

    if (this.conversationHistory.length === 0) {
      this.conversationHistory.push({
        role: "system",
        content: this.config.systemInstruction,
      });
    }

    this.conversationHistory.push({ role: "user", content: prompt });

    try {
      let rounds = 0;
      const tools = getAgentToolDeclarations();

      while (rounds < this.config.maxRoundsPerTick) {
        let response;
        try {
          response = await this.provider.chat(this.conversationHistory, tools);
        } catch (e) {
          console.error(`[Orchestrator] Provider (${this.provider.id}) error:`, e);
          break;
        }

        this.conversationHistory.push({
          role: "assistant",
          content: response.content,
          tool_calls: response.tool_calls,
        });

        const toolCalls = response.tool_calls;
        if (!toolCalls || toolCalls.length === 0) {
          if (response.content) {
            console.log(
              `[Orchestrator] Agent reasoning: ${response.content.slice(0, 200)}...`
            );
          }
          // If the agent made observations but did not execute an action yet, prompt once to call perform_action
          if (collectedActions.length === 0 && rounds < this.config.maxRoundsPerTick - 1) {
            this.conversationHistory.push({
              role: "user",
              content: "You have reasoned about your observations. To proceed, call perform_action now with your action_id and target_ids.",
            });
            rounds++;
            continue;
          }
          break;
        }

        for (const call of toolCalls) {
          console.log(
            `[Orchestrator] Tool call: ${call.function.name}(${JSON.stringify(call.function.arguments).slice(0, 100)}...)`
          );

          let result: unknown;
          try {
            const rawArgs = (call.function.arguments as Record<string, unknown>) ?? {};
            const toolArgs: Record<string, unknown> = {
              actor_id: this.agentEntityId,
              agent_id: this.agentEntityId,
              ...rawArgs,
            };
            if (!toolArgs.actor_id) toolArgs.actor_id = this.agentEntityId;
            if (!toolArgs.agent_id) toolArgs.agent_id = this.agentEntityId;

            result = executeAgentTool(
              this.csg,
              call.function.name,
              toolArgs
            );

            // Collect action requests from perform_action calls
            if (
              call.function.name === "perform_action" &&
              result &&
              typeof result === "object"
            ) {
              const actionResult = result as Record<string, unknown>;
              if (actionResult.success) {
                if (actionResult.normalized_request) {
                  const req = actionResult.normalized_request as ActionRequest;
                  collectedActions.push({
                    ...req,
                    already_applied: true,
                  });
                } else {
                  collectedActions.push({
                    action_id: toolArgs.action_id as string,
                    actor_id: this.agentEntityId,
                    target_ids: (toolArgs.target_ids as string[]) ?? [],
                    params: (toolArgs.params as Record<string, unknown>) ?? {},
                    tick_submitted: tick,
                    already_applied: true,
                  });
                }
              }
            }
          } catch (e) {
            result = { error: String(e) };
          }

          this.conversationHistory.push({
            role: "tool",
            content: JSON.stringify(result),
          });
        }

        rounds++;
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
    const currentLocId = this.csg.getRelatedIds(this.agentEntityId, "located_in")[0];
    const currentLoc = currentLocId ? this.csg.getEntity(currentLocId) : null;
    const connectedLocIds = currentLocId ? this.csg.getRelatedIds(currentLocId, "enables") : [];
    const connectedLocs = connectedLocIds
      .map((id) => this.csg.getEntity(id))
      .filter(Boolean)
      .map((e) => `"${e!.name}" (ID: ${e!.id})`)
      .join(", ");

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
      currentLoc
        ? `Current Location: "${currentLoc.name}" (ID: ${currentLoc.id})`
        : `Current Location: Unknown`,
      connectedLocs
        ? `Connected Locations reachable via move_to: ${connectedLocs}`
        : `No known adjacent locations.`,
      ``,
      recentEvents
        ? `Recent events involving you:\n${recentEvents}`
        : "No recent events.",
      ``,
      `Instructions for this tick:`,
      `1. Use observe_surroundings to perceive nearby NPCs and objects.`,
      `2. When ready to act, call perform_action with the action_id (e.g. move_to, examine, speak_to, take, unlock) and target_ids.`,
      `What do you want to do?`,
    ].join("\n");
  }

  /**
   * Reset conversation history (start fresh context).
   */
  resetConversation(): void {
    this.conversationHistory = [];
  }
}
