/**
 * GOAP Planner Integration for Moriarty
 *
 * Uses `goap-solver` to generate optimal action sequences for agents based on
 * the current state of the Causal State Graph.
 *
 * Because Moriarty uses a complex relational graph and `goap-solver` uses flat
 * propositional logic (boolean/number records), this module acts as a bridge.
 */

import { planner, type Action as GOAPAction, type GoalFacts } from "goap-solver";
import type { CausalStateGraph } from "../csg/graph.js";
import type { ActionRequest, Entity } from "../types.js";

/**
 * A bridge interface that defines how to translate complex CSG state into
 * flat GOAP facts for a specific agent and context.
 */
export interface CSGToActionSpace {
  /** 
   * Extract current facts from the CSG. 
   * e.g. { "has_key": true, "is_at_door": false }
   */
  extractState(csg: CausalStateGraph, actorId: string): GoalFacts;
  
  /**
   * Define the available actions in terms of GOAP facts.
   * This is necessary because Moriarty actions are parameterized (e.g. pick_up(item)),
   * whereas GOAP actions are ground (e.g. pick_up_crystal_key).
   */
  getAvailableActions(csg: CausalStateGraph, actorId: string): Array<GOAPAction & { 
    // Metadata to convert the GOAP action back into a Moriarty ActionRequest
    moriartyRequest: Omit<ActionRequest, "tick_submitted"> 
  }>;
}

export class MoriartyPlanner {
  constructor(private csg: CausalStateGraph, private translator: CSGToActionSpace) {}

  /**
   * Generates a sequence of Moriarty ActionRequests to achieve a given goal.
   *
   * @param actorId The ID of the entity planning the actions
   * @param goal The desired state expressed as GoalFacts
   * @returns Array of ActionRequests to submit to the engine, or null if no plan exists.
   */
  plan(actorId: string, goal: GoalFacts): Omit<ActionRequest, "tick_submitted">[] | null {
    const currentState = this.translator.extractState(this.csg, actorId);
    const goapActions = this.translator.getAvailableActions(this.csg, actorId);

    // Call the goap-solver
    const rawPlan = planner(currentState, goal, goapActions);

    if (!rawPlan) {
      return null;
    }

    // The rawPlan contains the generic GOAPActions. We need to map them back
    // to the Moriarty ActionRequests we attached in `getAvailableActions`.
    return rawPlan.map(goapAction => {
      // Find the original action with the metadata
      const original = goapActions.find(a => a.name === goapAction.name);
      if (!original) {
        throw new Error(`Plan contained unknown action: ${goapAction.name}`);
      }
      return original.moriartyRequest;
    });
  }
}
