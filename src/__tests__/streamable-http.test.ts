import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { CausalStateGraph } from "../runtime/csg/graph.js";
import { UEBridgeClient, StreamableHttpPostTransport } from "../runtime/bridge/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

describe("StreamableHttpPostTransport & HTTP Bridge Integration", () => {
  let server: http.Server;
  const port = 9902;
  const receivedRequests: Array<{ method?: string; headers: http.IncomingHttpHeaders; body: any }> = [];

  beforeAll(async () => {
    server = http.createServer(async (req, res) => {
      let bodyText = "";
      for await (const chunk of req) {
        bodyText += chunk;
      }
      const parsedBody = bodyText ? JSON.parse(bodyText) : null;
      receivedRequests.push({ method: req.method, headers: req.headers, body: parsedBody });

      if (parsedBody?.method === "initialize") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Mcp-Session-Id": "test-session-12345",
        });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: parsedBody.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: { listChanged: true } },
              serverInfo: { name: "mock-http-ue", version: "5.8.0" },
            },
          })
        );
      } else if (parsedBody?.method === "notifications/initialized") {
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end();
      } else if (parsedBody?.method === "tools/list") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Mcp-Session-Id": "test-session-12345",
        });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: parsedBody.id,
            result: {
              tools: [
                { name: "spawn_actor", inputSchema: { type: "object" } },
                { name: "update_actor", inputSchema: { type: "object" } },
                { name: "destroy_actor", inputSchema: { type: "object" } },
              ],
            },
          })
        );
      } else if (parsedBody?.method === "tools/call") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Mcp-Session-Id": "test-session-12345",
        });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: parsedBody.id,
            result: { content: [{ type: "text", text: "OK" }] },
          })
        );
      } else {
        res.writeHead(400);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(port, resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("should perform full Streamable HTTP POST handshake with Mcp-Session-Id propagation", async () => {
    const transport = new StreamableHttpPostTransport(new URL(`http://127.0.0.1:${port}/mcp`));
    const client = new Client({ name: "moriarty-test", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);

    expect(transport.sessionId).toBe("test-session-12345");

    const tools = await client.listTools();
    expect(tools.tools.length).toBe(3);

    const callResult = await client.callTool({
      name: "spawn_actor",
      arguments: { name: "Agent_1" },
    });
    expect(callResult.content).toEqual([{ type: "text", text: "OK" }]);

    await client.close();

    // Verify Mcp-Session-Id was attached to post-initialize calls
    const toolsListReq = receivedRequests.find((r) => r.body?.method === "tools/list");
    expect(toolsListReq).toBeDefined();
    expect(toolsListReq?.headers["mcp-session-id"]).toBe("test-session-12345");

    const callReq = receivedRequests.find((r) => r.body?.method === "tools/call");
    expect(callReq).toBeDefined();
    expect(callReq?.headers["mcp-session-id"]).toBe("test-session-12345");
  });

  it("should connect UEBridgeClient via HTTP endpoint and push spatial updates", async () => {
    const csg = new CausalStateGraph();
    const bridge = new UEBridgeClient(csg, {
      serverUrl: `http://127.0.0.1:${port}/mcp`,
      autoConnect: false,
    });

    const connected = await bridge.connect();
    expect(connected).toBe(true);

    await bridge.pushStateDelta({
      entities_added: [
        {
          id: "entity-1",
          name: "TestActor",
          type: "agent",
          properties: {
            position: { type: "vector3", value: { x: 50, y: 100, z: 150 } },
          },
        },
      ],
      entities_removed: [],
      entities_modified: [],
      relations_added: [],
      relations_removed: [],
    });

    await bridge.close();
  });
});
