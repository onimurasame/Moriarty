import { describe, it, expect, beforeEach } from "vitest";
import { CausalStateGraph } from "../runtime/csg/graph.js";

describe("CausalStateGraph Query Engine", () => {
  let csg: CausalStateGraph;

  beforeEach(() => {
    csg = new CausalStateGraph();
  });

  it("should query entities by type and tag", () => {
    csg.addEntity({ type: "location", name: "Courtyard", tags: ["exterior"] });
    csg.addEntity({ type: "location", name: "Dungeon", tags: ["interior", "dark"] });
    csg.addEntity({ type: "object", name: "Lantern", tags: ["light", "interior"] });

    const locations = csg.query({
      type: "entities_by_type",
      params: { type: "location" },
    });
    expect(locations.entities).toHaveLength(2);
    expect(locations.count).toBe(2);

    const interiorEntities = csg.query({
      type: "entities_by_tag",
      params: { tag: "interior" },
    });
    expect(interiorEntities.entities).toHaveLength(2);
    expect(interiorEntities.entities?.map((e) => e.name)).toEqual(
      expect.arrayContaining(["Dungeon", "Lantern"])
    );
  });

  it("should query entities located in a specific room", () => {
    const library = csg.addEntity({ type: "location", name: "Library" });
    const book = csg.addEntity({ type: "object", name: "Ancient Grimoire" });
    const scholar = csg.addEntity({ type: "npc", name: "Scholar" });
    const outsideTree = csg.addEntity({ type: "object", name: "Oak Tree" });

    csg.addRelation({ type: "located_in", source: book.id, target: library.id });
    csg.addRelation({ type: "located_in", source: scholar.id, target: library.id });

    const occupants = csg.query({
      type: "entities_in_location",
      params: { location_id: library.id },
    });

    expect(occupants.entities).toHaveLength(2);
    expect(occupants.entities?.map((e) => e.id)).toEqual(
      expect.arrayContaining([book.id, scholar.id])
    );
    expect(occupants.entities?.some((e) => e.id === outsideTree.id)).toBe(false);
  });

  it("should query relations connected to an entity", () => {
    const sword = csg.addEntity({ type: "object", name: "Steel Sword" });
    const warrior = csg.addEntity({ type: "agent", name: "Warrior" });
    const armoury = csg.addEntity({ type: "location", name: "Armoury" });

    csg.addRelation({ type: "owns", source: warrior.id, target: sword.id });
    csg.addRelation({ type: "located_in", source: warrior.id, target: armoury.id });

    const warriorRelations = csg.query({
      type: "relations_of",
      params: { entity_id: warrior.id, direction: "both" },
    });

    expect(warriorRelations.relations).toHaveLength(2);

    const swordInbound = csg.query({
      type: "relations_of",
      params: { entity_id: sword.id, direction: "inbound" },
    });
    expect(swordInbound.relations).toHaveLength(1);
    expect(swordInbound.relations?.[0].type).toBe("owns");
  });

  it("should discover BFS paths between entities across relations", () => {
    const a = csg.addEntity({ type: "location", name: "Room A" });
    const b = csg.addEntity({ type: "location", name: "Room B" });
    const c = csg.addEntity({ type: "location", name: "Room C" });

    csg.addRelation({ type: "custom", source: a.id, target: b.id });
    csg.addRelation({ type: "custom", source: b.id, target: c.id });

    const pathResult = csg.query({
      type: "path_between",
      params: { start_id: a.id, end_id: c.id, max_depth: 5 },
    });

    expect(pathResult.paths).toBeDefined();
    expect(pathResult.paths).toHaveLength(1);
    expect(pathResult.paths?.[0]).toEqual([a.id, b.id, c.id]);
  });

  it("should query spatial entities by proximity", () => {
    const origin = csg.addEntity({
      type: "agent",
      name: "Surveyor",
      properties: { position: { type: "vector3", value: { x: 0, y: 0, z: 0 } } },
    });
    const nearChest = csg.addEntity({
      type: "object",
      name: "Nearby Chest",
      properties: { position: { type: "vector3", value: { x: 2, y: 0, z: 0 } } },
    });
    const distantTower = csg.addEntity({
      type: "object",
      name: "Distant Tower",
      properties: { position: { type: "vector3", value: { x: 100, y: 50, z: 0 } } },
    });

    const nearby = csg.query({
      type: "entities_near",
      params: { center: { x: 0, y: 0, z: 0 }, radius: 10 },
    });

    expect(nearby.entities?.map((e) => e.id)).toContain(nearChest.id);
    expect(nearby.entities?.map((e) => e.id)).not.toContain(distantTower.id);
  });
});
