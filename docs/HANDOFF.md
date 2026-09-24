# Moriarty Project Handoff Briefing

**Generated:** 2026-09-24  
**Repository:** [https://github.com/onimurasame/Moriarty](https://github.com/onimurasame/Moriarty)  
**Local Root:** `C:\Users\onimu\.gemini\antigravity-ide\scratch\Moriarty`  

---

## 1. Current State & Setup Status

| Component | Status | Location / Reference |
|---|---|---|
| **Git & Remote** | Clean, synchronized on `main` | `origin/main` ([GitHub](https://github.com/onimurasame/Moriarty)) |
| **Managed Agents Spec** | Configured | [`.agents/AGENTS.md`](file:///C:/Users/onimu/.gemini/antigravity-ide/scratch/Moriarty/.agents/AGENTS.md) |
| **Installed Skills** | Ready (`gemini-api-dev`) | [`.agents/skills/gemini-api-dev`](file:///C:/Users/onimu/.gemini/antigravity-ide/scratch/Moriarty/.agents/skills/gemini-api-dev) |
| **MCP Integration** | Active globally | `gemini-api-docs-mcp` (`https://gemini-api-docs-mcp.dev`) |
| **Engine Config** | Initialized | [`config/engine.yaml`](file:///C:/Users/onimu/.gemini/antigravity-ide/scratch/Moriarty/config/engine.yaml) |
| **Documentation** | Initialized | [`docs/specification.md`](file:///C:/Users/onimu/.gemini/antigravity-ide/scratch/Moriarty/docs/specification.md) |
| **Code Source** | Scaffolding created | [`src/`](file:///C:/Users/onimu/.gemini/antigravity-ide/scratch/Moriarty/src) |

---

## 2. Operating Constraints & Invariants

1. **Target Knowledge Base Routing:**
   - **Backend ID:** `notebooks/4708df45-03a5-454d-811c-dc0401a2e16b` ("Open world Game as Agent Harness").
   - **No Scratchpads in VCS:** Agent execution loops, plan reflections, and scratchpads must be pushed to the NotebookLM session or active memory store. Keep the repository tree clean of temporary markdown files.

2. **Model & Agent Standards:**
   - Agent Base: `antigravity-preview-05-2026`
   - Primary LLM: `gemini-3.8-flash` (or `gemini-flash-latest`)
   - SDK: `@google/genai` (Node.js) or `google-genai` (Python) >= 2.3.0.

---

## 3. Recommended Next Implementation Steps

1. **Set Active Workspace:** Open [`C:\Users\onimu\.gemini\antigravity-ide\scratch\Moriarty`](file:///C:/Users/onimu/.gemini/antigravity-ide/scratch/Moriarty) as the active workspace in the IDE.
2. **Scaffold Runtime Harness (`src/`):**
   - Initialize package manifests (`package.json` or `pyproject.toml`).
   - Implement the ontology causal state graph engine.
   - Implement agent action handlers and environment tick orchestrator.
