// Imported/adapted from @tintinweb/pi-subagents 0.23.0 src/workflow/worker-source.ts (MIT).
/**
 * worker-source.ts — the JavaScript that runs inside the workflow worker thread.
 *
 * The host spawns this with `new Worker(WORKER_SOURCE, { eval: true })`, so the
 * source is assembled from strings so worker startup is independent of the
 * TypeScript loader and file paths after bundling. Keeping it as a template
 * literal costs editor tooling but nothing else — the worker is plain CommonJS
 * JavaScript and never sees the TypeScript pipeline.
 *
 * Two boundaries stack here, and they are not the same boundary:
 *
 *   host thread  ←postMessage→  worker thread  ←vm context→  workflow script
 *
 * The worker/host split exists for *killability*: `worker.terminate()` stops a
 * runaway script mid-loop, which an in-process `vm` timeout cannot do once the
 * script is inside an `await`. The vm context exists for *determinism and
 * accident-avoidance*, not security — see the note on `codeGeneration` below.
 *
 * ## Why the context gets no host built-ins
 *
 * `vm.createContext(sandbox)` gives the script a fresh realm that already owns
 * `Object`, `Array`, `JSON`, `Math`, `Date`, `Promise`, `Map`, `Set`. We inject
 * *only* our own globals on top. Injecting host built-ins instead would hand the
 * script `Object.constructor` → the **host** `Function`, i.e. a compiler for
 * arbitrary host-realm code.
 *
 * That said: our injected globals are themselves host closures, so
 * `agent.constructor` is still the host `Function`. The hygiene shrinks the
 * surface; it does not close the hole. `codeGeneration: { strings: false }`
 * makes the realm's own `Function("…")` and `eval("…")` throw `EvalError`;
 * a captured host Function still belongs to the host and is not constrained by
 * that setting. This is a determinism boundary for cooperative scripts, not a
 * security boundary against a hostile script.
 *
 * ## Why determinism is a prelude and not a stub
 *
 * Because `Date` and `Math` come *from the realm*, they cannot be neutered by
 * injection — there is nothing to inject over. So the compiled source is
 * prefixed with a prelude that runs inside the realm and reassigns `Date.now`
 * and `Math.random` in place, then lexically shadows `Date` with a subclass
 * whose zero-argument constructor throws. Lexical shadowing rather than a global
 * assignment because a `const` in the IIFE scope cannot be reached around.
 *
 * Determinism is enforced because a workflow's journal is replayed by prefix on
 * resume: a script that reads the clock produces a different prefix on the
 * second run and the replay silently diverges.
 */

/**
 * Runs inside the realm, ahead of the script body, on a single line.
 *
 * One line matters: the body is compiled at `\n` + line 1, and the host passes
 * `lineOffset: -1` so reported line numbers match the file the author wrote. Any
 * newline in here shifts every stack frame in every workflow script.
 */
const DETERMINISM_PRELUDE =
  "const Date = (function () {" +
  " const RealDate = globalThis.Date;" +
  " const die = function (what) {" +
  " throw new Error(what + \" is unavailable in workflow scripts (breaks resume)." +
  " Stamp results after the workflow returns, or pass timestamps via `args`.\");" +
  " };" +
  " RealDate.now = function () { return die(\"Date.now()\"); };" +
  " Math.random = function () { return die(\"Math.random()\"); };" +
  " return class WorkflowDate extends RealDate {" +
  " constructor() { if (arguments.length === 0) die(\"new Date()\"); super(...arguments); }" +
  " };" +
  "})();";

export const BOOTSTRAP_SOURCE = `"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const vm = require("node:vm");

const port = parentPort;
const ITEM_CAP = workerData.itemCap;
const PRELUDE = ${JSON.stringify(DETERMINISM_PRELUDE)};

/* ------------------------------------------------------------------ *
 * RPC to the host
 *
 * The script never touches the agent manager. Every effect leaves as a
 * "call" message and comes back as a "response", so the host owns the
 * semaphore, the caps, and the abort story.
 * ------------------------------------------------------------------ */

let nextCallId = 1;
const pendingCalls = new Map();

/**
 * Output tokens this run has spent, as last reported by the host.
 *
 * A mirror, not a tally: every response carries the host's current total, so
 * there is exactly one counter and it cannot drift. Between responses it cannot
 * be stale in any way the script could observe — tokens only accrue through
 * agents, and an agent's response is the only thing the script waits on.
 */
let spentOutput = 0;

function callHost(method, payload) {
  // Drain first, so the phase() that named this agent reaches the host ahead of
  // the agent entry rather than a tick behind it.
  flushProgress();
  return new Promise(function (resolve, reject) {
    const callId = nextCallId++;
    pendingCalls.set(callId, { resolve: resolve, reject: reject });
    port.postMessage({ type: "call", callId: callId, method: method, payload: payload });
  });
}

port.on("message", function (message) {
  if (!message || message.type !== "response") return;
  if (typeof message.spent === "number") spentOutput = message.spent;
  const waiter = pendingCalls.get(message.callId);
  if (!waiter) return;
  pendingCalls.delete(message.callId);
  if (message.ok) {
    waiter.resolve(message.value);
    return;
  }
  const error = new Error(message.error || "The workflow host rejected the call.");
  // Fatal errors are the run's, not the item's: parallel() and pipeline()
  // swallow ordinary failures into null, and a cap breach must not be
  // silently absorbed that way.
  if (message.fatal) error.workflowFatal = true;
  waiter.reject(error);
});

function isFatal(error) {
  return !!(error && typeof error === "object" && error.workflowFatal === true);
}

/* ------------------------------------------------------------------ *
 * Progress entries
 * ------------------------------------------------------------------ */

let progressQueue = [];
let flushTimer = null;

function emit(entry) {
  progressQueue.push(entry);
  // Batched on a macrotask: a fan-out emits a burst of phase/log entries in one
  // turn, and the host renders once per batch rather than once per entry.
  if (flushTimer === null) flushTimer = setTimeout(flushProgress, 0);
}

function flushProgress() {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (progressQueue.length === 0) return;
  const batch = progressQueue;
  progressQueue = [];
  port.postMessage({ type: "progress", entries: batch });
}

/* ------------------------------------------------------------------ *
 * The JSON boundary
 *
 * Checked here rather than relying on structured clone, which happily
 * carries cycles, BigInt and Maps that the progress log and the resume
 * journal cannot represent. Rejecting loudly beats writing a journal
 * that will not replay.
 * ------------------------------------------------------------------ */

let realmObjectPrototype = null;
/**
 * The realm's own \`JSON.parse\`.
 *
 * Module-scope, not local to main(), because \`agent({ schema })\` parses its
 * result here — outside main's closure — and the object has to carry the
 * *script's* Object.prototype, not the worker's, or \`instanceof Object\` fails
 * inside the script it was handed to.
 */
let realmParse = null;

/**
 * The top-level script's scope.
 *
 * Module-scope because a nested \`workflow()\` needs the realm-native function
 * compiler that \`main()\` builds, and because the compiled child function is
 * cached per body — see {@link workflowIn}.
 */
let rootScope = null;
/**
 * The vm context every script runs in.
 *
 * Held so a nested \`workflow()\` can compile its child there. Compiled from
 * *outside* the realm, with \`vm.Script\`, because the context itself has
 * \`codeGeneration.strings\` off — the script cannot build code, but the worker
 * that owns it still can.
 */
let realmContext = null;
/** Nested invocations made so far, against \`workerData.nestedCap\`. */
let nestedCount = 0;

function boundaryError(what, path) {
  return new Error(
    "Cannot pass " + what + " across the workflow VM boundary (at " + path + ")."
  );
}

function assertBoundary(value, path, seen) {
  if (value === null) return;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return;
  if (kind === "number") {
    if (!Number.isFinite(value)) throw boundaryError("a non-finite number", path);
    return;
  }
  if (kind === "undefined") {
    if (path === "the workflow result") return;
    throw boundaryError("undefined", path);
  }
  if (kind === "bigint") throw boundaryError("a BigInt", path);
  if (kind === "symbol") throw boundaryError("a symbol", path);
  if (kind === "function") throw boundaryError("a function", path);
  if (kind !== "object") throw boundaryError("a " + kind, path);

  if (seen.has(value)) throw boundaryError("a circular structure", path);
  seen.add(value);

  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw boundaryError("an object with symbol keys", path);
  }

  if (Array.isArray(value)) {
    const length = value.length;
    for (let i = 0; i < length; i++) {
      // A sparse array round-trips through JSON as nulls, which silently
      // changes the data. Reject instead.
      if (!Object.prototype.hasOwnProperty.call(value, i)) {
        throw boundaryError("a sparse array", path + "[" + i + "]");
      }
      assertBoundary(value[i], path + "[" + i + "]", seen);
    }
    seen.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  // Two prototypes are legitimate: the realm's own Object.prototype (anything
  // the script built) and the worker's (arrays we hand back from parallel).
  // Everything else — Map, Set, Date, a class instance — loses meaning here.
  if (prototype !== null && prototype !== realmObjectPrototype && prototype !== Object.prototype) {
    throw boundaryError("a non-plain object", path);
  }

  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i++) {
    assertBoundary(value[keys[i]], path + "." + keys[i], seen);
  }
  seen.delete(value);
}

function checkBoundary(value, path) {
  assertBoundary(value, path, new Set());
  return value;
}

/* ------------------------------------------------------------------ *
 * Realm helpers
 *
 * parallel() and pipeline() build their result arrays in worker code, but
 * the script should get an array its own realm recognises — otherwise
 * \`result instanceof Array\` is false and \`Array.isArray\` is the only thing
 * that works. Item values are moved across untouched.
 * ------------------------------------------------------------------ */

let realmNewArray = null;
let realmPush = null;

function toRealmArray(items) {
  const array = realmNewArray();
  for (let i = 0; i < items.length; i++) realmPush(array, items[i]);
  return array;
}

function toList(value, what) {
  if (!Array.isArray(value)) throw new Error(what + " expects an array.");
  const length = value.length >>> 0;
  if (length > ITEM_CAP) {
    throw new Error(
      what + " was given " + length + " items, over the limit of " + ITEM_CAP + "."
    );
  }
  const out = [];
  for (let i = 0; i < length; i++) out.push(value[i]);
  return out;
}

function requireText(value, what) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(what + " requires a non-empty string.");
  }
  return value;
}

function optionalText(value, what) {
  if (value === undefined || value === null) return undefined;
  return requireText(value, what);
}

/**
 * Reasoning effort a child may be spawned under — pi's \`ThinkingLevel\`.
 *
 * A superset of Claude Code's five, so a script written there runs here; the
 * extra \`minimal\` is pi's own. Validated in the worker rather than the host
 * because a typo should stop the script at the call that made it, not surface
 * later as an agent that quietly ran at the wrong depth.
 */
`;
