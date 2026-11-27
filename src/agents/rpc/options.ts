// Spawn names/normalization adapted from @tintinweb/pi-subagents 0.23.0 src/cross-extension-rpc.ts (MIT).
// Validate at the RPC boundary so misspelled options cannot silently change a run.
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { Type, type Static } from 'typebox';
import { Check, Errors } from 'typebox/value';
import { thinkingSchema } from '../schema.ts';
import type { StartAgent, StartOptions } from '../types.ts';

const schema = Type.Object({
  description: Type.Optional(Type.String()), name: Type.Optional(Type.String()),
  model: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null(),
    Type.Object({ provider: Type.String({ minLength: 1 }), id: Type.String({ minLength: 1 }) })])),
  maxTurns: Type.Optional(Type.Integer({ minimum: 0 })), isolated: Type.Optional(Type.Boolean()),
  inheritContext: Type.Optional(Type.Boolean()), thinkingLevel: Type.Optional(thinkingSchema),
  isBackground: Type.Optional(Type.Boolean()), bypassQueue: Type.Optional(Type.Boolean()),
  cwd: Type.Optional(Type.Union([Type.String(), Type.Null()])), signal: Type.Optional(Type.Any()),
  structuredOutput: Type.Optional(Type.Any()), onSpawned: Type.Optional(Type.Any()),
  onQueued: Type.Optional(Type.Any()), onCompaction: Type.Optional(Type.Any()),
}, { additionalProperties: false });

export function normalizeSpawn(type: unknown, prompt: unknown, raw: unknown): { request: StartAgent; options: StartOptions } {
  if (typeof type !== 'string' || !type.trim()) throw new Error('Invalid agent type. Resend with a non-empty type string.');
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Invalid agent prompt. Resend with a non-empty prompt string.');
  const value = raw ?? {};
  if (!Check(schema, value)) throw new Error(`Invalid spawn options: ${[...Errors(schema, value)].map(error => `${error.instancePath}: ${error.message}`).join('; ')}. Correct the listed fields and retry.`);
  const o = value as Static<typeof schema>;
  for (const key of ['onSpawned', 'onQueued', 'onCompaction'] as const) {
    if (o[key] !== undefined && typeof o[key] !== 'function') throw new Error(`SpawnOptions.${key} is not a function. Pass a function or omit it.`);
  }
  if (o.signal !== undefined && !(o.signal instanceof AbortSignal)) throw new Error('SpawnOptions.signal is not an AbortSignal. Pass an AbortSignal or omit it.');
  if (o.structuredOutput !== undefined && (!o.structuredOutput || o.structuredOutput.schema?.type !== 'object' || typeof o.structuredOutput.check !== 'function')) {
    throw new Error('Invalid SpawnOptions.structuredOutput. Pass an object schema with a check(value) function, or omit it.');
  }
  if (o.cwd != null) {
    if (!isAbsolute(o.cwd)) throw new Error(`SpawnOptions.cwd is not absolute: "${o.cwd}". Pass an absolute path or omit cwd.`);
    if (!statSync(o.cwd).isDirectory()) throw new Error(`SpawnOptions.cwd is not a directory: "${o.cwd}". Pass an existing directory or omit cwd.`);
  }
  const model = o.model == null ? undefined : typeof o.model === 'string' ? o.model : `${o.model.provider}/${o.model.id}`;
  return { request: { type, prompt, name: o.name, model, maxTurns: o.maxTurns, isolated: o.isolated,
    inheritContext: o.inheritContext, thinking: o.thinkingLevel, background: o.isBackground ?? false },
  options: { description: o.description, bypassQueue: o.bypassQueue, cwd: o.cwd ?? undefined, signal: o.signal,
    structuredOutput: o.structuredOutput, onSpawned: o.onSpawned, onQueued: o.onQueued, onCompaction: o.onCompaction, detached: true } };
}
