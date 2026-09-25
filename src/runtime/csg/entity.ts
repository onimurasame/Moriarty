/**
 * Entity CRUD — Create, read, update, and delete operations for world entities.
 *
 * All mutations go through this module to ensure metadata consistency
 * and version tracking for optimistic concurrency.
 */

import { v7 as uuidv7 } from "uuid";
import type {
  Entity,
  EntityType,
  EntityMetadata,
  PropertyValue,
  Component,
  Vector3,
} from "../types.js";

/**
 * Options for creating a new entity.
 * Only `type` and `name` are required; everything else has sensible defaults.
 */
export interface CreateEntityOptions {
  type: EntityType;
  name: string;
  properties?: Record<string, PropertyValue>;
  components?: Record<string, Component>;
  tags?: string[];
  created_by?: string;
  position?: Vector3;
}

/**
 * Create a new entity with a time-ordered UUID and initialized metadata.
 */
export function createEntity(
  currentTick: number,
  options: CreateEntityOptions
): Entity {
  const id = uuidv7();

  const properties = new Map<string, PropertyValue>(
    Object.entries(options.properties ?? {})
  );

  // If a position is provided, set it as a property
  if (options.position) {
    properties.set("position", {
      type: "vector3",
      value: options.position,
    });
  }

  const components = new Map<string, Component>(
    Object.entries(options.components ?? {})
  );

  const metadata: EntityMetadata = {
    created_at: currentTick,
    created_by: options.created_by ?? "system",
    last_modified_at: currentTick,
    version: 1,
    tags: options.tags ?? [],
  };

  return {
    id,
    type: options.type,
    name: options.name,
    properties,
    components,
    relations: [],
    metadata,
  };
}

/**
 * Set a property on an entity. Bumps version and last_modified_at.
 * Returns a new entity object (immutable update pattern).
 */
export function setEntityProperty(
  entity: Entity,
  key: string,
  value: PropertyValue,
  currentTick: number
): Entity {
  const newProperties = new Map(entity.properties);
  newProperties.set(key, value);

  return {
    ...entity,
    properties: newProperties,
    metadata: {
      ...entity.metadata,
      last_modified_at: currentTick,
      version: entity.metadata.version + 1,
    },
  };
}

/**
 * Remove a property from an entity.
 */
export function removeEntityProperty(
  entity: Entity,
  key: string,
  currentTick: number
): Entity {
  const newProperties = new Map(entity.properties);
  newProperties.delete(key);

  return {
    ...entity,
    properties: newProperties,
    metadata: {
      ...entity.metadata,
      last_modified_at: currentTick,
      version: entity.metadata.version + 1,
    },
  };
}

/**
 * Attach a component to an entity.
 */
export function addComponent(
  entity: Entity,
  component: Component,
  currentTick: number
): Entity {
  const newComponents = new Map(entity.components);
  newComponents.set(component.type, component);

  return {
    ...entity,
    components: newComponents,
    metadata: {
      ...entity.metadata,
      last_modified_at: currentTick,
      version: entity.metadata.version + 1,
    },
  };
}

/**
 * Remove a component from an entity.
 */
export function removeComponent(
  entity: Entity,
  componentType: string,
  currentTick: number
): Entity {
  const newComponents = new Map(entity.components);
  newComponents.delete(componentType);

  return {
    ...entity,
    components: newComponents,
    metadata: {
      ...entity.metadata,
      last_modified_at: currentTick,
      version: entity.metadata.version + 1,
    },
  };
}

/**
 * Add a tag to an entity.
 */
export function addTag(
  entity: Entity,
  tag: string,
  currentTick: number
): Entity {
  if (entity.metadata.tags.includes(tag)) return entity;

  return {
    ...entity,
    metadata: {
      ...entity.metadata,
      last_modified_at: currentTick,
      version: entity.metadata.version + 1,
      tags: [...entity.metadata.tags, tag],
    },
  };
}

/**
 * Remove a tag from an entity.
 */
export function removeTag(
  entity: Entity,
  tag: string,
  currentTick: number
): Entity {
  if (!entity.metadata.tags.includes(tag)) return entity;

  return {
    ...entity,
    metadata: {
      ...entity.metadata,
      last_modified_at: currentTick,
      version: entity.metadata.version + 1,
      tags: entity.metadata.tags.filter((t) => t !== tag),
    },
  };
}

/**
 * Track a relation ID on the entity.
 */
export function addRelationRef(entity: Entity, relationId: string): Entity {
  if (entity.relations.includes(relationId)) return entity;
  return {
    ...entity,
    relations: [...entity.relations, relationId],
  };
}

/**
 * Remove a relation ID reference from the entity.
 */
export function removeRelationRef(entity: Entity, relationId: string): Entity {
  return {
    ...entity,
    relations: entity.relations.filter((r) => r !== relationId),
  };
}

/**
 * Get a property value from an entity, with type narrowing.
 */
export function getProperty(
  entity: Entity,
  key: string
): PropertyValue | undefined {
  return entity.properties.get(key);
}

/**
 * Get the position of an entity, if it has one.
 */
export function getPosition(entity: Entity): Vector3 | undefined {
  const prop = entity.properties.get("position");
  if (prop && prop.type === "vector3") {
    return prop.value;
  }
  return undefined;
}

/**
 * Convenience: get a numeric property value.
 */
export function getNumber(
  entity: Entity,
  key: string
): number | undefined {
  const prop = entity.properties.get(key);
  if (prop && prop.type === "number") {
    return prop.value;
  }
  return undefined;
}

/**
 * Convenience: get a string property value.
 */
export function getString(
  entity: Entity,
  key: string
): string | undefined {
  const prop = entity.properties.get(key);
  if (prop && prop.type === "string") {
    return prop.value;
  }
  return undefined;
}

/**
 * Convenience: get a boolean property value.
 */
export function getBoolean(
  entity: Entity,
  key: string
): boolean | undefined {
  const prop = entity.properties.get(key);
  if (prop && prop.type === "boolean") {
    return prop.value;
  }
  return undefined;
}
