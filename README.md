# Moriarty: Open-World Game as Agent Harness

Project Moriarty is an open-world simulation engine and agent harness powered by Gemini Managed Agents (`antigravity-preview-05-2026`) and Executable Ontologies.

---

## Directory Structure

```
Moriarty/
├── .agents/
│   ├── AGENTS.md               # Managed Agents specification, ontology schemas, memory routing
│   └── skills/
│       └── gemini-api-dev/     # Official Gemini API & Managed Agent development skill
├── config/
│   └── engine.yaml             # Engine, model, and harness configurations
├── docs/
│   ├── specification.md        # Architecture overview and design spec
│   └── HANDOFF.md              # Full state transition & handoff briefing
├── src/                        # Implementation source code (executable ontology & harness)
├── .gitignore                  # Excludes scratchpads, logs, and temp artifacts from VCS
├── skills-lock.json            # Installed skill lockfile
└── README.md                   # Repository overview
```

---

## Knowledge Base & Memory Policy

- **Target Knowledge Base:** Gemini Notebook `notebooks/4708df45-03a5-454d-811c-dc0401a2e16b` (*"Open world Game as Agent Harness"*).
- **Zero-Scratchpad VCS Policy:** Transient agent thoughts, reflection loops, and runtime scratchpads are routed exclusively to NotebookLM / memory sessions; do NOT commit scratchpad markdown files to the repository.

---

## Quickstart

### Prerequisites
- Node.js >= 20 or Python >= 3.11
- Gemini API Key configured in your environment (`GEMINI_API_KEY`)
- Connected MCP: `gemini-api-docs-mcp` (remote endpoint: `https://gemini-api-docs-mcp.dev`)

### Recommended Workspace
Open this directory directly as your root workspace:
`C:\Users\onimu\.gemini\antigravity-ide\scratch\Moriarty`
