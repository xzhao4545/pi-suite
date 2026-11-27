// Imported/adapted from @tintinweb/pi-subagents 0.23.0 src/workflow/json-schema.ts (MIT).
// TypeBox v1 accepts plain JSON Schema without a TypeBox Kind symbol. Pass the
// same object to the provider and the checker so the two use the same contract.
// Keep the checker independent of Pi so workflow recovery can validate stored
// values without opening a child session. Pi also validates live tool inputs.

import { Check, Errors } from "typebox/value";

/** Maximum length of the serialized schema in UTF-16 code units. */
const MAX_SCHEMA_BYTES = 64 * 1024;

/** How many validation errors are quoted back to the model. */
const MAX_REPORTED_ERRORS = 5;

export interface CompiledSchema {
  /** The schema as given, for the tool's `parameters` and the journal key. */
  readonly schema: Record<string, unknown>;
  /** `true`, or a human-readable account of what is wrong. */
  check(value: unknown): true | string;
}

export type SchemaCompilation =
  | { ok: true; compiled: CompiledSchema }
  | { ok: false; message: string };

/**
 * Turn a script-supplied schema into something we can check against.
 *
 * Rejects up front rather than at the first tool call. A schema whose root is
 * not an object cannot be a tool's input schema at all, so it would break every
 * request the child makes rather than just the last one — and the author should
 * hear about that before a model is paid to discover it.
 */
export function compileJsonSchema(schema: unknown): SchemaCompilation {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return { ok: false, message: 'Invalid agent() opts.schema. Pass a JSON Schema object.' };
  }
  const root = schema as Record<string, unknown>;
  if (root.type !== "object") {
    return {
      ok: false,
      message: 'agent() opts.schema has a non-object or missing root type. Set the root type to "object".',
    };
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(root);
  } catch {
    return { ok: false, message: 'Cannot serialize agent() opts.schema. Pass a JSON-serializable schema.' };
  }
  if (serialized.length > MAX_SCHEMA_BYTES) {
    return {
      ok: false,
      message: `agent() opts.schema is too large (${serialized.length} UTF-16 code units; max ${MAX_SCHEMA_BYTES}). Shorten the schema.`,
    };
  }

  // Smoke-tested here so a schema the validator cannot walk fails at the call
  // that wrote it, with the schema in hand, rather than inside a child's tool
  // handler where the only symptom is an agent that never returns.
  try {
    Check(root, {});
  } catch (error) {
    return {
      ok: false,
      message: `Cannot validate agent() opts.schema: ${
        error instanceof Error ? error.message : String(error)
      }. Fix the schema before retrying.`,
    };
  }

  return { ok: true, compiled: { schema: root, check: value => checkAgainst(root, value) } };
}

function checkAgainst(schema: Record<string, unknown>, value: unknown): true | string {
  let valid: boolean;
  try {
    valid = Check(schema, value);
  } catch (error) {
    // Reported rather than thrown: a schema that compiled but trips on a
    // particular value must fail that call, not the run.
    return `the value could not be validated: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (valid) return true;

  const reported: string[] = [];
  try {
    for (const error of Errors(schema, value)) {
      // `instancePath` is JSON Pointer (`/a/b`); the model wrote the schema in
      // JavaScript, so it reads `$.a.b` far more easily.
      const path = String(error.instancePath ?? "");
      const where = path === "" ? "$" : `$${path.replace(/\//g, ".")}`;
      reported.push(`${where}: ${error.message}`);
      if (reported.length >= MAX_REPORTED_ERRORS) break;
    }
  } catch (error) {
    return `schema error reporting failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  return reported.length > 0 ? reported.join("; ") : "the value does not match the required schema";
}
