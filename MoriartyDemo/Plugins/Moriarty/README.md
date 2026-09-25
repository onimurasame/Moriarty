# Moriarty Unreal Engine Module

This module contains the necessary Unreal Engine integration components to bridge the Moriarty Executable Ontology Engine with Unreal Engine.

## Contents
1. **Moriarty Plugin** (`Moriarty.uplugin`, `Source/`): A standard Unreal Engine Plugin containing the base C++ actors (`AMoriartyActor`) for Moriarty entities.
2. **Setup Script** (`setup_blueprints.py`): An Unreal Python script to automatically generate the necessary Blueprints expected by the Node.js MCP client.

## Setup Instructions

### 1. Install the Plugin
Copy this entire `unreal-module` directory into the `Plugins/` folder of your Unreal Engine project (e.g., `MyProject/Plugins/Moriarty`). If the `Plugins` folder doesn't exist, create it.

Restart your Unreal Engine project. You may be prompted to rebuild the plugin modules.

### 2. Enable Dependencies
Ensure the **Model Context Protocol** plugin (and any WebSockets plugin required by it) is enabled in your Unreal Engine project.

### 3. Generate Blueprints
The Node.js runtime (`mcp.ts`) expects specific Blueprints to exist at `/Game/Moriarty/`. You can either create them manually (inheriting from `MoriartyActor`) or use the included Python script.

To use the script:
1. Ensure the **Python Editor Script Plugin** is enabled in Unreal Engine.
2. Go to **Tools -> Execute Python Script...**
3. Select the `setup_blueprints.py` script located in this folder.
4. It will generate `BP_Agent`, `BP_NPC`, and `BP_WorldObject` in the `/Game/Moriarty/` directory.

### 4. Running the Demo
1. Run Unreal Engine and start PIE (Play In Editor) so the MCP Server is active on port `8080` (or whatever your UE MCP server config uses).
2. In the Moriarty Node.js project, run the demo:
   ```bash
   npm run start -- --headless
   ```
3. The Node.js client will connect to Unreal Engine and begin spawning and updating the actors based on the Causal State Graph ticks.
