// Imported/adapted from @tintinweb/pi-subagents 0.23.0 src/agent-runner.ts (MIT).
import type { AgentSession, AgentSessionEvent, DefaultResourceLoader, InlineExtension } from "@earendil-works/pi-coding-agent";
import { extensionCanonicalNames, isMcpToolName, MCP_BRIDGE_TOOL_NAMES, matchesToolPattern } from "./selectors.ts";

export function installExtensionToolScope(
  session: AgentSession,
  ctx: {
    loader: DefaultResourceLoader;
    toolNames: string[];
    disallowedSet: Set<string> | undefined;
    extNames: Set<string>;
    narrowing: Map<string, Set<string>>;
    /** MCP patterns from tools; undefined leaves MCP tools to the ordinary selection rules. */
    mcpToolPatterns: string[] | undefined;
    /** Selected injected tools, including parent questions, nested delegation and memory. */
    readmitToolNames: Set<string>;
    /** Receives the scope check the child's nested-call gate extension applies. */
    nestedCallGate: NestedCallGate;
  },
): void {
  const { loader, toolNames, disallowedSet, extNames, narrowing, mcpToolPatterns, readmitToolNames, nestedCallGate } =
    ctx;
  // Factories/paths are fixed for this child; late registrations change their tool maps only.
  // Resolve file/package aliases once, rather than re-read manifests on every tool invocation.
  const aliases = new Map(loader.getExtensions().extensions.map(extension => [extension.path, extensionCanonicalNames(extension.path)]));

  // Any ext: selector turns extension tools into an allowlist: an unnamed extension still
  // loads and runs its handlers but contributes no tools, and ext:foo/bar narrows foo to bar.
  const inScope = (): Set<string> => {
    const denied = (name: string) => matchesToolPattern(name, [...disallowedSet ?? []]);
    const keep = new Set(session.getAllTools().map(tool => tool.name).filter(name => matchesToolPattern(name, toolNames) && !denied(name)));
    const optInActive = extNames.size > 0;
    for (const extension of loader.getExtensions().extensions) {
      // The shared suite registers its complete tool set; only the run's selected suite tools
      // belong here. It is not an external extension that an opt-in can accidentally widen.
      if (extension.path === '<inline:pi-suite-child>' || extension.path === '<inline:pi-suite-scope>') continue;
      const canons = aliases.get(extension.path)!;
      if (optInActive && !canons.some((c) => extNames.has(c))) continue;
      // First narrowing alias wins: one extension is not narrowed under two different names.
      const narrowed = canons.map((c) => narrowing.get(c)).find(Boolean);
      for (const name of extension.tools.keys()) {
        if (narrowed && !narrowed.has(name)) continue;
        if (denied(name)) continue;
        keep.add(name);
      }
    }
    // Bare `mcp__` entries, as in pi's `--tools`: only matching MCP tools stay, from
    // whichever extension serves them (pi's MCP or an adapter), even one the `ext:`
    // opt-in left out — and so do the bridges that reach them.
    if (mcpToolPatterns) {
      for (const name of keep) {
        if (!isMcpToolName(name)) continue;
        // Resource helpers serve multiple namespaces through a server argument;
        // an explicit helper selection must not be erased by a server-tool filter.
        const selected = name.startsWith('mcp__') ? matchesToolPattern(name, mcpToolPatterns) : matchesToolPattern(name, toolNames);
        if (!selected) keep.delete(name);
      }
      for (const extension of loader.getExtensions().extensions) {
        for (const name of extension.tools.keys()) {
          if (denied(name)) continue;
          if (MCP_BRIDGE_TOOL_NAMES.has(name) || matchesToolPattern(name, mcpToolPatterns)) keep.add(name);
        }
      }
    }
    // Injected tools (parent questions, nested delegation, memory) belong to this agent even
    // when tools: omits them. The caller already applied disallowed_tools to this set.
    for (const name of readmitToolNames) if (!denied(name)) keep.add(name);
    return keep;
  };

  // Names this agent selects explicitly: its built-ins, injected tools, `ext:foo/bar`
  // narrowings and exact `mcp__` entries. pi activates a named tool even when it is
  // `defaultActive: false`, as `--tools` does.
  const named = new Set([
    ...session.getAllTools().map(tool => tool.name).filter(name => matchesToolPattern(name, toolNames)),
    ...readmitToolNames,
    ...[...narrowing.values()].flatMap((s) => [...s]),
    ...(mcpToolPatterns ?? []).filter((p) => !p.includes("*")),
  ]);

  // Activate what pi itself would: only tools declared to the model (`direct`/
  // `model-only` exposure), and of those only named ones or ones not opted out
  // with `defaultActive: false`. `codemode`/`deferred` tools (pi's MCP tools by
  // default) stay undeclared until their extension or `tool_search` activates
  // them — so an already-active tool is kept, or turn_end would undo that.
  const renarrow = () => {
    const allowed = inScope();
    const current = session.getActiveToolNames();
    const active = new Set(current);
    const next = session
      .getAllTools()
      .filter(({ name, exposure = "direct" }) => {
        if (!allowed.has(name)) return false;
        if (active.has(name)) return true;
        if (exposure !== "direct" && exposure !== "model-only") return false;
        return named.has(name) || session.getToolDefinition(name)?.defaultActive !== false;
      })
      .map((t) => t.name);
    // setActiveToolsByName unconditionally rebuilds the system prompt, so skip
    // the no-op that steady-state turns would otherwise pay for every turn.
    if (next.length !== current.length || next.some((n, i) => n !== current[i])) {
      session.setActiveToolsByName(next);
    }
  };

  // Activate what registered during session_start (eager MCP servers); pi would
  // otherwise leave only its four default built-ins active at turn 1.
  renarrow();

  session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "turn_end") renarrow();
  });

  nestedCallGate.allows = (name) => inScope().has(name);

  const priorBeforeToolCall = session.agent.beforeToolCall;
  session.agent.beforeToolCall = async (context, signal) => {
    if (!inScope().has(context.toolCall.name)) {
      return {
        block: true,
        reason: `Tool "${context.toolCall.name}" is not available to this subagent. Use one of your listed tools.`,
      };
    }
    return priorBeforeToolCall?.(context, signal);
  };
}

/** Set once the child's tool scope is installed; until then the gate admits everything. */
export type NestedCallGate = { allows?: (name: string) => boolean };

const SCOPE_GATE_NAME = "pi-suite-scope";

/** Pi sends ctx.executeTool calls (including codemode) through tool_call, not agent.beforeToolCall. */
export function scopeGateExtension(gate: NestedCallGate): InlineExtension {
  return {
    name: SCOPE_GATE_NAME,
    hidden: true,
    factory: (ext) => {
      ext.on("tool_call", (event) =>
        gate.allows?.(event.toolName) === false
          ? { block: true, reason: `Tool "${event.toolName}" is not available to this subagent. Use one of your listed tools.` }
          : undefined,
      );
    },
  };
}

