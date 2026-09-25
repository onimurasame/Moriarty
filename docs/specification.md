# Moriarty: Executable Ontology & Causal State Graph Specification

**Version:** 0.1.0  
**Target Knowledge Base Backend:** Gemini Notebook `notebooks/4708df45-03a5-454d-811c-dc0401a2e16b` ("Open world Game as Agent Harness")  
**Policy:** Zero-Scratchpad VCS Policy; transitory memory traces route to NotebookLM backend.

---

## 1. System Architecture Overview

Project Moriarty provides an open-world simulation harness that couples an executable ontology with an autonomous agent orchestrator and spatial game engines. The architecture comprises five primary subsystems:

1. **Causal State Graph (CSG):** The single source of truth for all world entities, temporal relations, properties, and the immutable append-only event log.
2. **Executable Ontology Subsystem:** Declarative schemas (YAML) defining entity types, relation constraints, parameterized action schemas, preconditions, and atomic state effects.
3. **Simulation Tick Loop:** Deterministic discrete-time simulation coordinator that advances ticks, executes agent turns, processes world events, and emits diff snapshots.
4. **Agent Orchestrator & GOAP Planner:** Dual-layer decision making combining goal-oriented action planning (GOAP) for deterministic tactical execution with LLM orchestration (@google/genai Gemini 3.8 Flash / local fallback) for open-ended reasoning.
5. **Renderer Bridge (MCP):** Model Context Protocol (MCP) client bridging state deltas to Unreal Engine 5.8+ and external automation targets.

```
                      ┌─────────────────────────────────────────┐
                      │            Declarative YAML             │
                      │  (base-ontology.yaml, demo-world.yaml)  │
                      └────────────────────┬────────────────────┘
                                           │
                                           ▼
┌──────────────────────┐      ┌─────────────────────────┐      ┌──────────────────────┐
│  Agent Orchestrator  │      │   Causal State Graph    │      │    GOAP Planner      │
│  (Gemini / Local)    │◄────►│  (Entities + Relations) │◄────►│ (GoalFacts & Plans)  │
└──────────────────────┘      └────────────┬────────────┘      └──────────────────────┘
                                           │
                                           ▼
                              ┌─────────────────────────┐
                              │  Simulation Tick Loop   │
                              │    (Events & Deltas)    │
                              └────────────┬────────────┘
                                           │
                                           ▼
                              ┌─────────────────────────┐
                              │     UE MCP Bridge       │
                              │ (StateDelta tool calls) │
                              └─────────────────────────┘
```

---

## 2. Causal State Graph (CSG) Specification

### 2.1 Entity Model
Every world entity is assigned a time-ordered UUID (UUIDv7) and categorized into one of six canonical types:
- `agent`: Autonomous actors driven by external models or planners.
- `npc`: Scripted or rule-driven inhabitants.
- `object`: Interactive items, containers, mechanisms, and props.
- `location`: Spatial regions, zones, rooms, or navigation waypoints.
- `concept`: Abstract ontological nodes (factions, quests, knowledge domains).
- `event`: Reified events instantiated for causal provenance tracking.

Entities maintain:
- Typed property maps (`number`, `string`, `boolean`, `vector3`, `ref`, `list`).
- Component bags (`inventory`, `dialogue`, `health`, etc.).
- Active relation references.
- Metadata including creation tick, creator ID, modification tick, and monotonic version counter.

### 2.2 Relational Model
Relations are directed, typed edges between source and target entities with temporal validity windows:
- Core relation types: `located_in`, `owns`, `knows`, `allied_with`, `hostile_to`, `contains`, `depends_on`, `caused_by`, `blocks`, `enables`, `custom`.
- Invariants:
  - Directed edges are maintained within an underlying multi-graph data structure (`graphology`).
  - Active relations have `valid_until === null`. Deactivated relations store their retirement tick, preserving historical lineage.
  - Multi-edge support: Multiple distinct relations of different types may exist between the same source and target pair.

### 2.3 Action Execution & Causal Mechanics
Action execution is atomic and deterministic:
1. **Validation:** Preconditions (`property_check`, `relation_exists`, `relation_absent`, `proximity`, `inventory_has`, `entity_type_is`) are verified against current CSG state.
2. **Evaluation:** If all preconditions pass, the action succeeds; if any condition fails, the action is rejected with the explicit list of failed conditions.
3. **Effect Application:** Mutating effects are executed atomically:
   - `set_property`: Modifies or sets an entity property value.
   - `modify_property`: Numerically increments/decrements a property with boundary clamping.
   - `add_relation`: Instantiates a new directed relation edge.
   - `remove_relation`: Deactivates an existing relation by assigning `valid_until = currentTick`.
   - `create_entity`: Dynamically creates a new entity in the graph.
   - `destroy_entity`: Removes an entity and cascades deactivation across attached relations.
   - `emit_event`: Emits secondary events establishing causal chains (`caused_by`).
4. **Append-Only Event Log:** Every executed action generates an immutable `EventEntry` recording tick, action ID, actor ID, targets, preconditions status, applied effects, and causal parents.

### 2.4 Snapshotting & State Deltas
- Full state can be exported as a JSON-serializable `WorldSnapshot` capturing all entities, relations, tick counter, and event count.
- `calculateDelta(previous, current, events)` calculates the exact difference between two ticks:
  - Added entities, modified entities (attribute diffs), removed entity IDs.
  - Added relations, removed relation IDs.
  - Newly logged event entries.
- Enables bandwidth-efficient, asynchronous synchronization with external renderers.

---

## 3. Query Engine Specification

The query engine evaluates structured queries against the CSG with deterministic complexity:
- `entities_by_type`: Filters all entities matching a specific `EntityType`.
- `entities_by_tag`: Filters entities containing a specified metadata tag.
- `entities_in_location`: Finds all entities connected to a location entity via `located_in` or `contains`.
- `relations_of`: Retrieves all inbound and outbound active relations for an entity.
- `path_between`: Executes breadth-first search (BFS) over active relations to discover relation path chains between two entities.
- `entities_near`: Spatial Euclidean distance filtering based on `position` Vector3 properties.
- `events_caused_by`: Traverses the causal DAG backwards from an event ID to isolate causal parent trees.
- `events_at_tick`: Temporal slice of events recorded at a specified tick.

---

## 4. Agent Tool & Orchestration Specification

### 4.1 Orchestrator Agent Protocol
The orchestrator agent operates over discrete ticks:
1. **Perception:** Agent inspects visible surroundings via `observe_surroundings` or queries via `query_world`.
2. **Deliberation:** Evaluates goals, inventory, and location state.
3. **Action Execution:** Invokes `perform_action` with action ID, targets, and parameters.
4. **Feedback Loop:** Action results (success/failure, reason) return immediately to inform subsequent moves within `maxRoundsPerTick`.
5. **Tool Argument Smoothing & Coercion:** To accommodate behavioral differences across LLM model families (e.g. small local models stringifying JSON objects or arrays), tool arguments must be robustly normalized:
   - Target IDs: Coerce JSON stringified arrays (`"[\"...\"]"`), raw comma-delimited strings, or singular `target_id` into `string[]`.
   - Action IDs: Resolve aliases (`action`, `action_id`).
   - Actor IDs: Auto-inject agent entity ID if missing or resolve (`actor_id`, `agent_id`).
   - Parameters: Parse JSON-encoded strings into property maps.
   - Numeric properties: Parse numeric strings (e.g. `"50"`) into numbers.

### 4.2 LLM Provider Abstraction & Interface Contract
To decouple agent orchestration from concrete inference endpoints and facilitate deterministic verification, all model interactions implement the `LLMProvider` contract:

```typescript
export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: Array<{
    id?: string;
    type: "function";
    function: {
      name: string;
      arguments: Record<string, unknown>;
    };
  }>;
}

export interface LLMToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMResponse {
  content?: string;
  tool_calls?: Array<{
    id?: string;
    function: {
      name: string;
      arguments: Record<string, unknown>;
    };
  }>;
}

export interface LLMProvider {
  readonly id: string;
  chat(
    messages: LLMMessage[],
    tools: LLMToolDeclaration[]
  ): Promise<LLMResponse>;
}
```

#### Provider Implementations:
1. **`MockProvider`:** A deterministic provider with two operating modes:
   - *Scripted Queue Mode:* Pre-programmed sequence of responses and tool calls for testing specific branching scenarios.
   - *Autonomous Heuristic Mode:* Inspects the user turn prompt and CSG context, emitting deterministic tool calls (`observe_surroundings` -> `perform_action`).
2. **`OllamaProvider`:** Connects to the local host Ollama daemon via the `ollama` SDK.
3. **`GeminiProvider`:** Connects to `@google/genai` using model `gemini-3.8-flash`.

### 4.3 GOAP (Goal-Oriented Action Planning) Bridge
For deterministic sub-goals:
- `CSGToActionSpace`: Translates relational graph state into propositional facts (`GoalFacts`).
- `MoriartyPlanner`: Computes minimum-cost action plans utilizing `goap-solver` and translates them into executable `ActionRequest` sequences.

### 4.4 Spatial Position Synchronization & Unreal Engine MCP Bridge
1. **Baseline Snapshot Commitment:** Loading or hydrating a world establishes the initial baseline snapshot via `CausalStateGraph.commitBaseline()`. Subsequent simulation ticks compute state deltas relative to the state at the start of each tick.
2. **Spatial Invariant:** When an entity transitions locations (via `located_in` relation updates), if the target location defines a spatial `position` Vector3, the entity's `position` property is synchronized to the location's coordinates.
3. **State Delta Transmission & Initial Sync:**
   - `UEBridgeClient.initialSync()` spawns all pre-existing entities in Unreal Engine via `spawn_actor`.
   - `CausalStateGraph.advanceTick` calculates the state delta for each tick.
   - For modified entities whose `position` property changed, `UEBridgeClient.pushStateDelta` invokes the Unreal Engine MCP tool `update_actor` with `{ id: entity.id, changes: mod.changes, location: entity.position }`.
4. **UE MCP Server Protocol:**
   - **Transport:** Supports both native Unreal Engine 5.8 Streamable HTTP POST endpoints (`http://127.0.0.1:8080/mcp`) and WebSocket endpoints (`ws://127.0.0.1:8080/mcp`).
   - **Streamable HTTP POST Lifecycle:** For HTTP endpoints, client performs `initialize` handshake, extracts `Mcp-Session-Id` header from server response, dispatches `notifications/initialized`, and attaches `Mcp-Session-Id` on all subsequent JSON-RPC request headers.
   - **Tools Exposed & Dynamic Fallback:** On connection, `UEBridgeClient` discovers active server tools via `tools/list`. If `spawn_actor`, `update_actor`, or `destroy_actor` are registered, they are called over MCP; otherwise, simulated spatial synchronization is safely recorded without throwing.
   - **Verification:** An in-process mock MCP WebSocket server and direct unit tests validate that state deltas produce corresponding tool invocations and that coordinates match target location transforms.

---

## 5. Verification & Testing Requirements

To satisfy strict quality and reproducibility directives:
1. **Complete Codebase Test Coverage:** All core systems (`csg`, `query`, `ontology`, `world-loader`, `planner`, `tools`, `simulation`, `provider`, `ue-bridge`) must be tested.
2. **Zero Non-Deterministic Flakiness:** All test executions must use fixed seeds, reproducible mock clocks, and synthetic fixtures.
3. **VCS Cleanliness Invariant:** No transient scratchpads, markdown execution logs, or runtime caches may be staged in git.
