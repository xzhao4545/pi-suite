import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { Key, type KeyId } from "@earendil-works/pi-tui";

const keyNames = Object.values(Key).flatMap(key => typeof key === "string"
  ? [key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")] : []);
const keyPattern = `^(?:(?:ctrl|alt|shift|super)\\+)*(?:[a-z0-9]|${keyNames.join("|")})$`;

const display = Type.String({ enum: ["status", "dock", "hidden"] });
const schema = Type.Object({
  modules: Type.Optional(Type.Object({
    ask: Type.Optional(Type.Boolean()), tasks: Type.Optional(Type.Boolean()),
    jobs: Type.Optional(Type.Boolean()), goal: Type.Optional(Type.Boolean()),
    agents: Type.Optional(Type.Boolean()),
  }, { additionalProperties: false })),
  ui: Type.Optional(Type.Object({ maxRows: Type.Optional(Type.Integer({ minimum: 1, maximum: 6 })) }, { additionalProperties: false })),
  ask: Type.Optional(Type.Object({
    timeout: Type.Optional(Type.Integer({ minimum: 0, maximum: 2147483647 })),
    historyKey: Type.Optional(Type.String({ pattern: keyPattern })),
  }, { additionalProperties: false })),
  goal: Type.Optional(Type.Object({ display: Type.Optional(display) }, { additionalProperties: false })),
  agents: Type.Optional(Type.Object({ display: Type.Optional(display) }, { additionalProperties: false })),
  jobs: Type.Optional(Type.Object({
    display: Type.Optional(display),
    detachKey: Type.Optional(Type.String({ pattern: keyPattern })),
    returnKey: Type.Optional(Type.String({ pattern: keyPattern })),
    transferKey: Type.Optional(Type.String({ pattern: keyPattern })),
  }, { additionalProperties: false })),
}, { additionalProperties: false });

export type DisplayMode = "status" | "dock" | "hidden";
export interface SuiteConfig {
  modules: Record<"ask" | "tasks" | "jobs" | "goal" | "agents", boolean>;
  ui: { maxRows: number };
  ask: { timeout: number; historyKey: KeyId };
  goal: { display: DisplayMode };
  agents: { display: DisplayMode };
  /** Terminal view keys: leave the view, hand input back to the model, send the screen to the model. */
  jobs: { display: DisplayMode; detachKey: KeyId; returnKey: KeyId; transferKey: KeyId };
}
export const defaults: SuiteConfig = {
  modules: { ask: true, tasks: true, jobs: true, goal: true, agents: true },
  ui: { maxRows: 6 }, ask: { timeout: 120000, historyKey: "ctrl+h" },
  goal: { display: "status" }, agents: { display: "status" },
  jobs: { display: "status", detachKey: "ctrl+b", returnKey: "ctrl+g", transferKey: "ctrl+t" },
};

function readConfig(path: string): Static<typeof schema> {
  let raw: string;
  try { raw = readFileSync(path, "utf8"); }
  catch (error) {
    // Absence means no override; permission and I/O failures must remain visible.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const value: unknown = JSON.parse(raw);
  if (!Value.Check(schema, value)) throw new Error(`Invalid pi-suite configuration: ${path}`);
  return value;
}

export function loadConfig(cwd: string, agentDir = getAgentDir()): SuiteConfig {
  const user = readConfig(join(agentDir, "pi-suite.json"));
  const project = readConfig(join(cwd, ".pi", "pi-suite.json"));
  // Merge individual sections so a project timeout does not reset user shortcuts.
  return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [
    key, { ...value, ...user[key as keyof typeof user], ...project[key as keyof typeof project] },
  ])) as unknown as SuiteConfig;
}
