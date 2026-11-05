// Imported/adapted from @tintinweb/pi-subagents 0.23.0 src/workflow/worker-source.ts (MIT).
import { BOOTSTRAP_SOURCE } from "./bootstrap.ts";
import { SCOPE_SOURCE } from "./scope.ts";
import { FLOW_SOURCE } from "./flow.ts";

// All pieces share the worker's lexical scope, matching the upstream single script.
export const WORKER_SOURCE = BOOTSTRAP_SOURCE + SCOPE_SOURCE + FLOW_SOURCE;
