/**
 * Moriarty MCP Bridge — Integrates with Unreal Engine 5.8+ MCP Server
 *
 * This module connects to the Unreal Engine MCP Server via Streamable HTTP POST
 * or WebSocket, invoking tools to spawn actors, update transforms, and synchronize the 
 * Causal State Graph with the renderer.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { CausalStateGraph } from "../csg/graph.js";
import type { StateDelta, SerializedEntity } from "../types.js";

/**
 * Streamable HTTP POST Transport for Unreal Engine 5.8 ModelContextProtocol server.
 * Unreal Engine's experimental MCP HTTP listener expects POST JSON-RPC messages and
 * tracks active sessions via the Mcp-Session-Id response and request header.
 */
export class StreamableHttpPostTransport implements Transport {
  private url: URL;
  public sessionId?: string;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(url: URL) {
    this.url = url;
  }

  async start(): Promise<void> {}

  async close(): Promise<void> {
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    const res = await fetch(this.url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(message),
    });

    const newSessionId = res.headers.get("mcp-session-id");
    if (newSessionId) {
      this.sessionId = newSessionId;
    }

    if (res.status === 202) {
      return;
    }

    const text = await res.text();
    if (text && text.trim().length > 0) {
      try {
        const json = JSON.parse(text) as JSONRPCMessage;
        if (this.onmessage) {
          this.onmessage(json);
        }
      } catch (err: any) {
        this.onerror?.(err);
      }
    }
  }
}

export interface UEBridgeOptions {
  serverUrl?: string;
  autoConnect?: boolean;
}

export class UEBridgeClient {
  private client: Client;
  private csg: CausalStateGraph;
  private connected = false;
  private serverUrl: string;
  private transport: Transport | null = null;
  private discoveredTools = new Set<string>();

  constructor(
    csg: CausalStateGraph,
    options?: UEBridgeOptions | string
  ) {
    this.csg = csg;
    if (typeof options === "string") {
      this.serverUrl = options;
    } else {
      this.serverUrl = options?.serverUrl ?? "http://127.0.0.1:8080/mcp";
    }

    this.client = new Client(
      { name: "moriarty-runtime", version: "0.1.0" },
      { capabilities: {} }
    );

    const autoConnect = typeof options === "object" ? (options.autoConnect ?? true) : true;
    if (autoConnect) {
      this.connect().catch((err) => {
        console.warn("[UE Bridge] Failed initial connect:", err?.message ?? err);
      });
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /**
   * Connect to the Unreal Engine MCP Server.
   */
  async connect(): Promise<boolean> {
    if (this.connected) return true;
    try {
      const url = new URL(this.serverUrl);
      if (url.protocol === "ws:" || url.protocol === "wss:") {
        this.transport = new WebSocketClientTransport(url);
      } else {
        this.transport = new StreamableHttpPostTransport(url);
      }
      await this.client.connect(this.transport);
      this.connected = true;

      try {
        const toolsList = await Promise.race([
          this.client.listTools(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("listTools timeout")), 300)
          ),
        ]);
        for (const tool of toolsList.tools) {
          this.discoveredTools.add(tool.name);
        }
      } catch {}

      console.log(
        `[UE Bridge] Connected to Unreal Engine MCP Server at ${this.serverUrl} (${this.discoveredTools.size} tools discovered)`
      );
      return true;
    } catch (err: any) {
      this.connected = false;
      console.warn(`[UE Bridge] Failed to connect to UE MCP Server (${this.serverUrl}): ${err?.message ?? err}`);
      return false;
    }
  }

  private shouldCallTool(toolName: string): boolean {
    if (this.discoveredTools.size === 0) return true;
    return this.discoveredTools.has(toolName);
  }

  /**
   * Spawns all active CSG entities in Unreal Engine via MCP.
   * Invoked upon initial connection to populate the scene.
   */
  async initialSync(): Promise<void> {
    if (!this.connected) return;
    try {
      const snap = this.csg.snapshot();
      for (const entity of Object.values(snap.entities)) {
        await this.spawnEntity(entity);
      }
      console.log(
        `[UE Bridge] Initial sync completed: ${Object.keys(snap.entities).length} entities processed.`
      );
    } catch (err) {
      console.error("[UE Bridge] Failed initial sync:", err);
    }
  }

  /**
   * Pushes a state delta to Unreal Engine by calling appropriate MCP tools
   * exposed by the UE MCP Server.
   */
  async pushStateDelta(delta: StateDelta): Promise<void> {
    if (!this.connected) return;

    try {
      // 1. Spawn new entities
      for (const entity of delta.entities_added) {
        await this.spawnEntity(entity);
      }

      // 2. Update modified entities
      for (const mod of delta.entities_modified) {
        let location: { x: number; y: number; z: number } | undefined;
        const posProp = mod.changes.properties?.["position"];
        if (posProp && posProp.type === "vector3") {
          location = posProp.value as { x: number; y: number; z: number };
        }

        if (this.shouldCallTool("update_actor")) {
          try {
            await this.client.callTool({
              name: "update_actor",
              arguments: {
                id: mod.id,
                changes: mod.changes,
                ...(location ? { location } : {}),
              },
            });
          } catch (err: any) {
            console.warn(`[UE Bridge] update_actor tool call skipped: ${err?.message ?? err}`);
          }
        } else {
          console.log(`[UE Bridge] Spatial update (simulated): ${mod.id} -> ${JSON.stringify(location)}`);
        }
      }

      // 3. Destroy removed entities
      for (const id of delta.entities_removed) {
        if (this.shouldCallTool("destroy_actor")) {
          try {
            await this.client.callTool({
              name: "destroy_actor",
              arguments: { id },
            });
          } catch (err: any) {
            console.warn(`[UE Bridge] destroy_actor tool call skipped: ${err?.message ?? err}`);
          }
        }
      }
    } catch (err) {
      console.error("[UE Bridge] Failed to push state delta via MCP:", err);
    }
  }

  private async spawnEntity(entity: SerializedEntity) {
    const ueClassMap: Record<string, string> = {
      agent: "/Game/Moriarty/BP_Agent.BP_Agent_C",
      npc: "/Game/Moriarty/BP_NPC.BP_NPC_C",
      object: "/Game/Moriarty/BP_WorldObject.BP_WorldObject_C",
    };

    const ueClass = ueClassMap[entity.type];
    if (!ueClass) return;

    let location = { x: 0, y: 0, z: 0 };
    const posProp = entity.properties["position"];
    if (posProp && posProp.type === "vector3") {
      location = posProp.value as { x: number; y: number; z: number };
    }

    if (this.shouldCallTool("spawn_actor")) {
      try {
        await this.client.callTool({
          name: "spawn_actor",
          arguments: {
            actor_class: ueClass,
            location,
            tags: [entity.id],
            name: entity.name,
          },
        });
      } catch (err: any) {
        console.warn(`[UE Bridge] spawn_actor tool call skipped: ${err?.message ?? err}`);
      }
    } else {
      console.log(
        `[UE Bridge] Actor spawned (simulated): ${entity.id} (${entity.name}) at (${location.x}, ${location.y}, ${location.z})`
      );
    }
  }

  /**
   * Gracefully close the MCP connection
   */
  async close() {
    if (this.connected) {
      await this.client.close();
      if (this.transport && "close" in this.transport) {
        try {
          await (this.transport as any).close();
        } catch {}
      }
      this.connected = false;
      console.log("[UE Bridge] Disconnected from UE MCP Server");
    }
  }
}
