/**
 * Simulation Tick Loop — The heartbeat of the Moriarty engine.
 *
 * Manages the simulation cycle:
 * 1. Collect action requests from agents
 * 2. Validate and execute actions
 * 3. Advance the tick
 * 4. Notify subscribers (UE bridge, logging, etc.)
 */

import type { CausalStateGraph } from "../csg/graph.js";
import type { ActionRequest, ActionResult, EventEntry } from "../types.js";

export interface TickLoopConfig {
  /** Milliseconds between ticks (default: 500) */
  tickInterval: number;
  /** Maximum ticks to run (0 = unlimited) */
  maxTicks: number;
  /** Whether to auto-advance or wait for manual trigger */
  autoAdvance: boolean;
}

const DEFAULT_CONFIG: TickLoopConfig = {
  tickInterval: 500,
  maxTicks: 0,
  autoAdvance: true,
};

/** Callback for processing agent turns each tick */
export type AgentTurnProcessor = (
  csg: CausalStateGraph,
  tick: number
) => Promise<ActionRequest[]>;

/** Callback invoked after each tick with results */
export type PostTickCallback = (
  tick: number,
  results: ActionResult[],
  events: EventEntry[]
) => void | Promise<void>;

export class SimulationTickLoop {
  private csg: CausalStateGraph;
  private config: TickLoopConfig;
  private running: boolean = false;
  private agentProcessors: AgentTurnProcessor[] = [];
  private postTickCallbacks: PostTickCallback[] = [];
  private pendingActions: ActionRequest[] = [];
  private tickTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(csg: CausalStateGraph, config?: Partial<TickLoopConfig>) {
    this.csg = csg;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register an agent turn processor.
   * Called each tick to collect action requests from agents.
   */
  registerAgentProcessor(processor: AgentTurnProcessor): void {
    this.agentProcessors.push(processor);
  }

  /**
   * Register a post-tick callback.
   */
  onPostTick(callback: PostTickCallback): void {
    this.postTickCallbacks.push(callback);
  }

  /**
   * Enqueue an action request for the current or next tick.
   */
  enqueueAction(request: ActionRequest): void {
    this.pendingActions.push(request);
  }

  /**
   * Start the simulation loop.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log(
      `[SimLoop] Starting — interval: ${this.config.tickInterval}ms, ` +
        `max ticks: ${this.config.maxTicks || "∞"}`
    );

    if (this.config.autoAdvance) {
      await this.runAutoLoop();
    }
  }

  /**
   * Stop the simulation loop.
   */
  stop(): void {
    this.running = false;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    console.log(`[SimLoop] Stopped at tick ${this.csg.currentTick}`);
  }

  /**
   * Run a single tick manually (for step-by-step debugging).
   */
  async stepOnce(): Promise<{
    tick: number;
    results: ActionResult[];
    events: EventEntry[];
  }> {
    return await this.executeTick();
  }

  /**
   * Whether the loop is currently running.
   */
  get isRunning(): boolean {
    return this.running;
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async runAutoLoop(): Promise<void> {
    while (this.running) {
      if (
        this.config.maxTicks > 0 &&
        this.csg.currentTick >= this.config.maxTicks
      ) {
        console.log(
          `[SimLoop] Reached max ticks (${this.config.maxTicks}). Stopping.`
        );
        this.stop();
        return;
      }

      await this.executeTick();

      // Wait for the tick interval
      await new Promise<void>((resolve) => {
        this.tickTimer = setTimeout(resolve, this.config.tickInterval);
      });
    }
  }

  private async executeTick(): Promise<{
    tick: number;
    results: ActionResult[];
    events: EventEntry[];
  }> {
    const tick = this.csg.currentTick;

    // 1. Collect action requests from agent processors
    for (const processor of this.agentProcessors) {
      try {
        const requests = await processor(this.csg, tick);
        this.pendingActions.push(...requests);
      } catch (err) {
        console.error(`[SimLoop] Agent processor error at tick ${tick}:`, err);
      }
    }

    // 2. Sort actions by priority (tick_submitted, then order)
    const actionsThisTick = [...this.pendingActions];
    this.pendingActions = [];

    // 3. Validate and execute each action
    const results: ActionResult[] = [];
    for (const action of actionsThisTick) {
      if (action.already_applied) {
        results.push({
          success: true,
          action_id: action.action_id,
          actor_id: action.actor_id,
          tick,
          effects_applied: [],
        });
        console.log(
          `[Tick ${tick}] ✓ ${action.action_id} by ${action.actor_id} (applied via tool)`
        );
        continue;
      }

      const result = this.csg.applyAction(action);
      results.push(result);

      if (result.success) {
        console.log(
          `[Tick ${tick}] ✓ ${action.action_id} by ${action.actor_id}`
        );
      } else {
        console.log(
          `[Tick ${tick}] ✗ ${action.action_id} by ${action.actor_id}: ${result.failure_reason}`
        );
      }
    }

    // 4. Get events from this tick
    const events = this.csg.getEventsAtTick(tick);

    // 5. Advance the tick
    this.csg.advanceTick();

    // 6. Notify post-tick callbacks
    for (const callback of this.postTickCallbacks) {
      try {
        await callback(tick, results, events);
      } catch (err) {
        console.error(`[SimLoop] Post-tick callback error:`, err);
      }
    }

    return { tick, results, events };
  }
}
