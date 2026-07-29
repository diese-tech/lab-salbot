import type { Json } from './types/database.types';

export function toDatabaseJson(value: unknown): Json {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error('Database JSON payload is not serializable.');
  }
  return JSON.parse(serialized) as Json;
}

export function parseDatabaseJsonObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}
