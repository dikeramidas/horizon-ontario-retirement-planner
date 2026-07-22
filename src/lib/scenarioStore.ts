import type { HouseholdInput } from "../simulate";

const PREFIX = "horizon:scenario:";
const INDEX_KEY = "horizon:scenario-index";
export const SCHEMA_VERSION = 1;

export interface SavedScenario {
  schemaVersion: number;
  id: string;
  name: string;
  savedAt: string;
  seed: number;
  inputs: HouseholdInput;
}

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndex(ids: string[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(ids));
}

export function listScenarios(): SavedScenario[] {
  return readIndex()
    .map((id) => loadScenario(id))
    .filter((s): s is SavedScenario => s != null)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function loadScenario(id: string): SavedScenario | null {
  try {
    const raw = localStorage.getItem(PREFIX + id);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedScenario;
    if (!s || s.schemaVersion !== SCHEMA_VERSION || !s.inputs) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveScenario(
  name: string,
  inputs: HouseholdInput,
  seed: number,
  id?: string
): SavedScenario {
  const scenario: SavedScenario = {
    schemaVersion: SCHEMA_VERSION,
    id: id ?? crypto.randomUUID(),
    name: name.trim() || "Untitled scenario",
    savedAt: new Date().toISOString(),
    seed,
    inputs,
  };
  localStorage.setItem(PREFIX + scenario.id, JSON.stringify(scenario));
  const idx = readIndex().filter((x) => x !== scenario.id);
  idx.unshift(scenario.id);
  writeIndex(idx.slice(0, 40));
  return scenario;
}

export function deleteScenario(id: string): void {
  localStorage.removeItem(PREFIX + id);
  writeIndex(readIndex().filter((x) => x !== id));
}

/** Node-safe pure round-trip helpers used by unit tests (no localStorage). */
export function serializeScenario(s: SavedScenario): string {
  return JSON.stringify(s);
}

export function deserializeScenario(raw: string): SavedScenario | null {
  try {
    const s = JSON.parse(raw) as SavedScenario;
    if (!s || s.schemaVersion !== SCHEMA_VERSION || !s.inputs?.persons) return null;
    return s;
  } catch {
    return null;
  }
}
