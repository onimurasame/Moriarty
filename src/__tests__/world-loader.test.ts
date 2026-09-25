import { describe, it, expect, beforeEach } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CausalStateGraph } from "../runtime/csg/graph.js";
import { loadWorld } from "../runtime/world-loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("World Loader Engine", () => {
  let csg: CausalStateGraph;

  beforeEach(() => {
    csg = new CausalStateGraph();
  });

  it("should load demo-world.yaml and establish entities and relations", () => {
    const worldPath = resolve(__dirname, "../schemas/demo-world.yaml");
    const idMap = loadWorld(csg, worldPath);

    expect(idMap.size).toBeGreaterThanOrEqual(11);
    expect(idMap.has("player_agent")).toBe(true);
    expect(idMap.has("entrance_hall")).toBe(true);
    expect(idMap.has("crystal_key")).toBe(true);
    expect(idMap.has("scholar_meridia")).toBe(true);

    const playerUuid = idMap.get("player_agent")!;
    const playerEntity = csg.getEntity(playerUuid);
    expect(playerEntity).toBeDefined();
    expect(playerEntity?.name).toBe("The Seeker");
    expect(playerEntity?.type).toBe("agent");

    // Check relations
    const entranceUuid = idMap.get("entrance_hall")!;
    expect(csg.hasRelation(playerUuid, entranceUuid, "located_in")).toBe(true);

    // Locations should be interconnected
    const libraryUuid = idMap.get("main_library")!;
    expect(csg.hasRelation(entranceUuid, libraryUuid, "enables")).toBe(true);
  });
});
