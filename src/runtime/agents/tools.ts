/**
 * Agent Tools — Gemini Function Calling tool definitions.
 *
 * These tools are exposed to the Gemini orchestrator agent so it can
 * interact with the Causal State Graph. Each tool maps to a CSG operation.
 */

import type { CausalStateGraph } from "../csg/graph.js";
import type {
  EntityType,
  RelationType,
  ActionRequest,
  Vector3,
} from "../types.js";
import { getPosition } from "../csg/entity.js";
import { serializeEntity, serializeRelation } from "../csg/snapshot.js";
import { distance3D } from "../csg/query.js";

/**
 * Function calling tool declarations for the Gemini API.
 * Pass these to `tools` in the Interactions API call.
 */
export function getAgentToolDeclarations() {
  return [
    {
      name: "observe_surroundings",
      description:
        "Get entities and relations visible from the agent's current location within a given radius. Returns a list of nearby entities with their types, names, and properties.",
      parameters: {
        type: "object" as const,
        properties: {
          agent_id: {
            type: "string",
            description: "The agent entity ID performing the observation",
          },
          radius: {
            type: "number",
            description:
              "Observation radius in world units (default: 50)",
          },
          filter_types: {
            type: "array",
            items: { type: "string" },
            description:
              "Entity types to include (e.g. ['object', 'npc']). Omit for all types.",
          },
        },
        required: ["agent_id"],
      },
    },
    {
      name: "perform_action",
      description:
        "Attempt an action in the world. The action is validated against the ontology rules — preconditions must be met. Returns success/failure with a causal explanation.",
      parameters: {
        type: "object" as const,
        properties: {
          action_id: {
            type: "string",
            description: "The action schema ID (e.g. 'pick_up', 'attack', 'speak_to')",
          },
          actor_id: {
            type: "string",
            description: "The entity ID performing the action",
          },
          target_ids: {
            type: "array",
            items: { type: "string" },
            description: "Target entity IDs for the action",
          },
          params: {
            type: "object",
            description: "Additional parameters for the action",
          },
        },
        required: ["action_id", "actor_id"],
      },
    },
    {
      name: "query_knowledge",
      description:
        "Query the agent's known facts, relationships, and event history. Use for checking what the agent knows about the world.",
      parameters: {
        type: "object" as const,
        properties: {
          agent_id: {
            type: "string",
            description: "The agent entity ID whose knowledge to query",
          },
          query_type: {
            type: "string",
            enum: [
              "known_entities",
              "relationships",
              "event_history",
              "location_contents",
            ],
            description: "The type of knowledge query",
          },
          filter: {
            type: "object",
            description: "Optional filter parameters",
          },
        },
        required: ["agent_id", "query_type"],
      },
    },
    {
      name: "inspect_entity",
      description:
        "Get detailed information about a specific entity the agent can perceive, including all its properties, components, and active relations.",
      parameters: {
        type: "object" as const,
        properties: {
          agent_id: {
            type: "string",
            description: "The agent requesting the inspection",
          },
          entity_id: {
            type: "string",
            description: "The entity to inspect",
          },
        },
        required: ["agent_id", "entity_id"],
      },
    },
    {
      name: "list_available_actions",
      description:
        "List all actions the agent can currently perform, given its type and the entities near it.",
      parameters: {
        type: "object" as const,
        properties: {
          agent_id: {
            type: "string",
            description: "The agent entity ID",
          },
        },
        required: ["agent_id"],
      },
    },
    {
      name: "get_world_summary",
      description:
        "Get a high-level summary of the current world state: entity counts, tick number, and recent events.",
      parameters: {
        type: "object" as const,
        properties: {},
      },
    },
  ];
}

/**
 * Execute an agent tool call and return the result as a JSON-serializable object.
 */
export function executeAgentTool(
  csg: CausalStateGraph,
  toolName: string,
  args: Record<string, unknown>
): unknown {
  switch (toolName) {
    case "observe_surroundings":
      return handleObserveSurroundings(csg, args);
    case "perform_action":
      return handlePerformAction(csg, args);
    case "query_knowledge":
      return handleQueryKnowledge(csg, args);
    case "inspect_entity":
      return handleInspectEntity(csg, args);
    case "list_available_actions":
      return handleListAvailableActions(csg, args);
    case "get_world_summary":
      return handleGetWorldSummary(csg);
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ─── Normalization Helpers ───────────────────────────────────────────────────

function normalizeStringArray(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) {
    return val.map((item) => String(item).trim()).filter((s) => s.length > 0);
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item).trim()).filter((s) => s.length > 0);
        }
      } catch {
        return trimmed
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      }
    }
    return [trimmed];
  }
  return [];
}

function normalizeObject(val: unknown): Record<string, unknown> {
  if (!val) return {};
  if (typeof val === "object" && !Array.isArray(val)) {
    return val as Record<string, unknown>;
  }
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeNumber(val: unknown, fallback: number): number {
  if (typeof val === "number" && !isNaN(val)) return val;
  if (typeof val === "string") {
    const parsed = parseFloat(val);
    if (!isNaN(parsed)) return parsed;
  }
  return fallback;
}

// ─── Tool Handlers ────────────────────────────────────────────────────────────

function handleObserveSurroundings(
  csg: CausalStateGraph,
  args: Record<string, unknown>
): unknown {
  const agentId = String(args.agent_id ?? args.actor_id ?? "").trim();
  const radius = normalizeNumber(args.radius, 50);
  const filterTypes = normalizeStringArray(args.filter_types) as EntityType[];

  const agent = csg.getEntity(agentId);
  if (!agent) return { error: `Agent not found: ${agentId}` };

  const agentPos = getPosition(agent);
  if (!agentPos) return { error: "Agent has no position" };

  let nearby = csg.getAllEntities().filter((e) => {
    if (e.id === agentId) return false;
    const pos = getPosition(e);
    if (!pos) return false;
    return distance3D(agentPos, pos) <= radius;
  });

  if (filterTypes && filterTypes.length > 0) {
    nearby = nearby.filter((e) => filterTypes.includes(e.type));
  }

  return {
    agent_location: agentPos,
    radius,
    tick: csg.currentTick,
    entities: nearby.map((e) => ({
      id: e.id,
      type: e.type,
      name: e.name,
      position: getPosition(e),
      distance: distance3D(agentPos, getPosition(e)!),
      tags: e.metadata.tags,
    })),
    count: nearby.length,
  };
}

function handlePerformAction(
  csg: CausalStateGraph,
  args: Record<string, unknown>
): unknown {
  const actionId = String(args.action_id ?? args.action ?? "").trim();
  const actorId = String(args.actor_id ?? args.agent_id ?? "").trim();
  const rawTargets = args.target_ids ?? args.target_id ?? [];
  const targetIds = normalizeStringArray(rawTargets);
  const params = normalizeObject(args.params);

  const request: ActionRequest = {
    action_id: actionId,
    actor_id: actorId,
    target_ids: targetIds,
    params,
    tick_submitted: csg.currentTick,
  };

  const result = csg.applyAction(request);
  return {
    success: result.success,
    action: result.action_id,
    tick: result.tick,
    event_id: result.event_id,
    effects_count: result.effects_applied.length,
    failure_reason: result.failure_reason,
    failed_conditions: result.failed_conditions?.map((c) => c.description ?? c.type),
    normalized_request: request,
  };
}

function handleQueryKnowledge(
  csg: CausalStateGraph,
  args: Record<string, unknown>
): unknown {
  const agentId = args.agent_id as string;
  const queryType = args.query_type as string;

  const agent = csg.getEntity(agentId);
  if (!agent) return { error: `Agent not found: ${agentId}` };

  switch (queryType) {
    case "known_entities": {
      // Entities the agent has a "knows" relation with
      const knownIds = csg.getRelatedIds(agentId, "knows");
      const knownEntities = knownIds
        .map((id) => csg.getEntity(id))
        .filter(Boolean)
        .map((e) => ({
          id: e!.id,
          type: e!.type,
          name: e!.name,
          tags: e!.metadata.tags,
        }));
      return { known_entities: knownEntities, count: knownEntities.length };
    }

    case "relationships": {
      const result = csg.query({
        type: "relations_of",
        params: { entity_id: agentId },
      });
      return {
        relationships: result.relations?.map((r) => ({
          id: r.id,
          type: r.type,
          source: r.source,
          target: r.target,
          since_tick: r.valid_from,
        })),
        count: result.count,
      };
    }

    case "event_history": {
      const events = csg
        .getEventLog()
        .filter((e) => e.actor === agentId || e.targets.includes(agentId));
      return {
        events: events.slice(-20).map((e) => ({
          id: e.id,
          tick: e.tick,
          action: e.action,
          success: e.preconditions_met,
          targets: e.targets,
        })),
        total_events: events.length,
      };
    }

    case "location_contents": {
      // Find what location the agent is in, then list everything there
      const locationIds = csg.getRelatedIds(agentId, "located_in");
      if (locationIds.length === 0) return { error: "Agent is not in any location" };

      const locationId = locationIds[0];
      const result = csg.query({
        type: "entities_in_location",
        params: { location_id: locationId },
      });

      return {
        location_id: locationId,
        location_name: csg.getEntity(locationId)?.name,
        entities: result.entities?.map((e) => ({
          id: e.id,
          type: e.type,
          name: e.name,
        })),
        count: result.count,
      };
    }

    default:
      return { error: `Unknown query type: ${queryType}` };
  }
}

function handleInspectEntity(
  csg: CausalStateGraph,
  args: Record<string, unknown>
): unknown {
  const agentId = args.agent_id as string;
  const entityId = args.entity_id as string;

  const agent = csg.getEntity(agentId);
  if (!agent) return { error: `Agent not found: ${agentId}` };

  const entity = csg.getEntity(entityId);
  if (!entity) return { error: `Entity not found: ${entityId}` };

  // Check if agent can perceive this entity (proximity or knowledge)
  const agentPos = getPosition(agent);
  const entityPos = getPosition(entity);
  const isNear =
    agentPos && entityPos && distance3D(agentPos, entityPos) <= 100;
  const isKnown = csg.hasRelation(agentId, entityId, "knows");

  if (!isNear && !isKnown) {
    return { error: "Entity is not perceivable by this agent" };
  }

  const serialized = serializeEntity(entity);

  // Get active relations
  const relResult = csg.query({
    type: "relations_of",
    params: { entity_id: entityId },
  });

  return {
    entity: serialized,
    relations: relResult.relations?.map((r) => ({
      type: r.type,
      direction: r.source === entityId ? "outgoing" : "incoming",
      other_entity: r.source === entityId ? r.target : r.source,
      other_name:
        csg.getEntity(r.source === entityId ? r.target : r.source)?.name ??
        "unknown",
    })),
  };
}

function handleListAvailableActions(
  csg: CausalStateGraph,
  args: Record<string, unknown>
): unknown {
  const agentId = args.agent_id as string;
  const agent = csg.getEntity(agentId);
  if (!agent) return { error: `Agent not found: ${agentId}` };

  const allActions = csg.getActionSchemas();
  const available = allActions.filter((a) => a.actor_types.includes(agent.type));

  return {
    agent_type: agent.type,
    actions: available.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      tick_cost: a.tick_cost,
      preconditions: a.preconditions.map((c) => c.description ?? c.type),
    })),
    count: available.length,
  };
}

function handleGetWorldSummary(csg: CausalStateGraph): unknown {
  const recentEvents = csg
    .getEventLog()
    .slice(-10)
    .map((e) => ({
      tick: e.tick,
      action: e.action,
      actor: e.actor,
      success: e.preconditions_met,
    }));

  return {
    tick: csg.currentTick,
    summary: csg.getSummary(),
    recent_events: recentEvents,
  };
}
