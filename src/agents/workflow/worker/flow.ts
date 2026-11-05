// Imported/adapted from @tintinweb/pi-subagents 0.23.0 src/workflow/worker-source.ts (MIT).
export const FLOW_SOURCE = `/** A barrier: ordinary item failures become null; fatal run errors propagate. */
async function parallel(thunks) {
  const list = toList(thunks, "parallel(thunks)");
  for (let i = 0; i < list.length; i++) {
    if (typeof list[i] !== "function") {
      throw new Error("parallel(thunks) expects an array of functions; item " + i + " is not one.");
    }
  }
  const settled = await Promise.all(
    list.map(async function (thunk) {
      try {
        return await thunk();
      } catch (error) {
        if (isFatal(error)) throw error;
        return null;
      }
    })
  );
  return toRealmArray(settled);
}

/**
 * No barrier between stages. Each item walks its own chain, so item A can be
 * in stage 3 while item B is still in stage 1 — which is the whole point:
 * a barrier makes every stage wait on its slowest sibling, and with agents in
 * the stages that latency is measured in minutes.
 *
 * A stage that throws drops that item to null and skips its remaining stages.
 * Every stage sees (previousResult, originalItem, index).
 */
async function pipeline(items, ...stages) {
  const list = toList(items, "pipeline(items, ...stages)");
  for (let i = 0; i < stages.length; i++) {
    if (typeof stages[i] !== "function") {
      throw new Error("pipeline(items, ...stages) expects stages to be functions; stage " + i + " is not one.");
    }
  }
  const settled = await Promise.all(
    list.map(async function (item, index) {
      let value = item;
      for (let s = 0; s < stages.length; s++) {
        try {
          value = await stages[s](value, item, index);
        } catch (error) {
          if (isFatal(error)) throw error;
          return null;
        }
      }
      return value;
    })
  );
  return toRealmArray(settled);
}

/**
 * The \`workflow(nameOrRef, args?)\` global.
 *
 * Runs another workflow inline. The child executes in *this* worker and *this*
 * vm context, as a function whose parameters shadow the globals — which is why
 * it shares the run's concurrency cap, agent counter, abort signal, journal and
 * budget without any of them being passed anywhere: there is only ever one of
 * each. What it does not share is ambient phase state, which lives on the scope.
 *
 * One level only, as in Claude Code. The child's \`workflow\` is present and
 * throws rather than absent, so the error names the limit instead of reading
 * \`workflow is not defined\`.
 */
async function workflowIn(scope, nameOrRef, args) {
  if (scope.depth > 0) {
    throw new Error(
      "workflow() cannot be nested more than one level deep — you are already inside the workflow '" +
        scope.name + "'. Call the agents inline instead."
    );
  }

  let ref;
  if (typeof nameOrRef === "string") {
    if (nameOrRef.trim() === "") throw new Error("workflow(nameOrRef) expects a non-empty name.");
    ref = { name: nameOrRef };
  } else if (nameOrRef && typeof nameOrRef === "object" && !Array.isArray(nameOrRef)) {
    const scriptPath = optionalText(nameOrRef.scriptPath, "workflow() scriptPath");
    const name = optionalText(nameOrRef.name, "workflow() name");
    if (scriptPath === undefined && name === undefined) {
      throw new Error("workflow({ ... }) expects a \`name\` or a \`scriptPath\`.");
    }
    ref = { name: name, scriptPath: scriptPath };
  } else {
    throw new Error("workflow(nameOrRef) expects a saved workflow name or { scriptPath }.");
  }

  const label = ref.name !== undefined ? ref.name : ref.scriptPath;
  if (args !== undefined) checkBoundary(args, 'workflow("' + label + '") args');

  if (nestedCount >= workerData.nestedCap) {
    // Fatal, like the agent cap: a limit that silently drops work would be
    // worse than no limit.
    const error = new Error(
      "Workflow exceeded its cap of " + workerData.nestedCap + " nested workflow() calls."
    );
    error.workflowFatal = true;
    throw error;
  }
  nestedCount++;

  let loaded;
  try {
    loaded = await callHost("workflow", ref);
  } catch (error) {
    // Resolution failures are the script's to handle — Claude Code documents
    // workflow() as throwing on an unknown name so a script can catch it.
    // Attributed, so a caught error says which reference failed.
    if (isFatal(error)) throw error;
    throw new Error('workflow("' + label + '"): ' + describe(error));
  }

  const child = makeScope(loaded.name, scope.depth + 1);
  // The child's own group, defined before its first agent so a child that never
  // calls phase() still reads as its own section rather than falling into the
  // parent's un-phased bucket.
  child.ambientPhaseIndex = definePhaseIn(child, undefined);
  child.ambientPhaseTitle = scopedTitle(child, undefined);

  let run;
  try {
    const compiled = new vm.Script(
      // \`meta\` is deliberately not a parameter: the body still opens with its
      // own \`const meta = { ... }\` (extractMeta strips only the \`export\`), so a
      // parameter of that name would collide with it.
      "(async (agent, phase, log, workflow, console, args) => {" + PRELUDE + "\\n" + loaded.body + "\\n})",
      { filename: "workflow:" + loaded.name + ".js", lineOffset: -1 }
    );
    run = compiled.runInContext(realmContext);
  } catch (error) {
    throw new Error('workflow("' + label + '"): ' + describe(error));
  }

  const value = await run(child.agent, child.phase, child.log, child.workflow, child.console, args);
  checkBoundary(value, 'the result of workflow("' + label + '")');
  return value;
}

/**
 * The \`budget\` global.
 *
 * \`total\` is permanently null, and that is the honest answer rather than a
 * stub: Claude Code fills it from the user's "+500k" directive and pi has no
 * such directive, so "no target set" is the state this runtime is always in.
 * Every pattern Claude Code documents guards on exactly that — \`while
 * (budget.total && ...)\`, \`budget.total ? ... : 5\` — so those scripts run here
 * unchanged and take the branch they were written for. Leaving \`budget\`
 * undefined instead would turn a graceful guard into a ReferenceError.
 *
 * \`spent()\` is real. It differs from Claude Code's in scope: theirs pools the
 * main loop and every workflow in the turn, ours counts this run's agents.
 */
function makeBudget() {
  return {
    total: null,
    spent: function () {
      return spentOutput;
    },
    remaining: function () {
      // Infinity, not a number, because there is no target to subtract from.
      return Infinity;
    },
  };
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

async function main() {
  rootScope = makeScope(undefined, 0);
  const sandbox = {
    agent: rootScope.agent,
    parallel: parallel,
    pipeline: pipeline,
    phase: rootScope.phase,
    log: rootScope.log,
    workflow: rootScope.workflow,
    budget: makeBudget(),
    console: rootScope.console,
  };
  const context = vm.createContext(sandbox, {
    name: "workflow",
    codeGeneration: { strings: false, wasm: false },
  });

  realmObjectPrototype = vm.runInContext("Object.prototype", context);
  realmNewArray = vm.runInContext("(function () { return []; })", context);
  realmPush = vm.runInContext("(function (array, value) { array.push(value); })", context);
  realmParse = vm.runInContext("JSON.parse", context);
  realmContext = context;

  // meta and args are materialised *inside* the realm rather than injected, so
  // the script sees objects whose prototype is its own Object.prototype and
  // whose .constructor is its own Function.
  sandbox.meta = realmParse(workerData.metaJson);
  sandbox.args = workerData.argsJson === undefined ? undefined : realmParse(workerData.argsJson);

  const script = new vm.Script("(async () => {" + PRELUDE + "\\n" + workerData.body + "\\n})()", {
    filename: "workflow.js",
    // The wrapper adds exactly one line above the body; undo it so a thrown
    // error points at the line the author wrote.
    lineOffset: -1,
  });

  const value = await script.runInContext(context);
  checkBoundary(value, "the workflow result");
  flushProgress();
  port.postMessage({
    type: "complete",
    resultJson: value === undefined ? undefined : JSON.stringify(value),
  });
}

main().catch(function (error) {
  flushProgress();
  port.postMessage({
    type: "error",
    message: error && error.message ? String(error.message) : String(error),
    stack: error && error.stack ? String(error.stack) : undefined,
  });
});
`;
