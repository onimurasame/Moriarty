# Project Moriarty: Open-World Game as Agent Harness
# Agent Specification & System Rules

## 1. System Overview & Knowledge Base Target
- **Project Name:** Moriarty
- **Role:** Open-World Agent Simulation Engine & Executable Ontology Harness
- **Target Knowledge Base Backend:**
  - **Gemini Notebook LM Backend:** `notebooks/4708df45-03a5-454d-811c-dc0401a2e16b` ("Open world Game as Agent Harness")
  - **Memory & Storage Policy:** Transitive documentation, runtime reflection traces, and agent scratchpads MUST be routed to the NotebookLM backend (`notebooks/4708df45-03a5-454d-811c-dc0401a2e16b`) or active agent memory sessions. Under no circumstance should transitory scratchpad markdown files be committed to the local git repository.

---

## 2. Managed Agents Configuration Schema

```yaml
version: "v1alpha"
system: "moriarty-simulation-engine"
agents:
  orchestrator:
    id: "moriarty-orchestrator"
    base_agent: "antigravity-preview-05-2026"
    model: "gemini-3.8-flash"
    description: "Primary orchestrator managing agent lifecycles, environment state, and ontological constraints."
    system_instruction: |
      You are the Moriarty Simulation Orchestrator. You manage the executable ontology harness
      and coordinate specialized subagents interacting within open-world environments.
      Enforce all ontological rules, validate action preconditions, and stream world state transitions.
    base_environment:
      type: "remote"
      sources:
        - type: "repository"
          source: "https://github.com/onimurasame/Moriarty"
          target: "/workspace/Moriarty"
    tools:
      - mcp: "gemini-api-docs-mcp"
      - skill: "gemini-api-dev"
    memory_backend:
      provider: "notebooklm"
      notebook_id: "notebooks/4708df45-03a5-454d-811c-dc0401a2e16b"
      sync_mode: "transitive_memory_only"
      persist_scratchpad_to_vcs: false

  world_sim:
    id: "moriarty-ontology-evaluator"
    base_agent: "antigravity-preview-05-2026"
    model: "gemini-3.8-flash"
    description: "Evaluates ontological causal graph transitions, agent action validity, and environment physics."
    system_instruction: |
      You evaluate actions against the Moriarty executable ontology.
      Update entity graphs, enforce causal invariants, and yield state diffs.
    base_environment:
      type: "remote"
      sources:
        - type: "repository"
          source: "https://github.com/onimurasame/Moriarty"
          target: "/workspace/Moriarty"
```

---

## 3. Operational Directives & Guidelines

1. **Repository Cleanliness:**
   - Commit only source code, formal configuration (`config/`), specifications (`docs/`), and agent definitions (`.agents/`).
   - Do not stage or commit temporary scratchpad logs, runtime caches, or transitory artifacts.

2. **Integration & Tooling:**
   - Use the `@google/genai` (Node.js) or `google-genai` (Python) SDK (version >= 2.3.0).
   - Use current models (`gemini-3.8-flash`, `antigravity-preview-05-2026`).
   - Leverage `gemini-api-docs-mcp` for live documentation and SDK reference.
