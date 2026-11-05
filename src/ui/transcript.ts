import {
  AssistantMessageComponent, UserMessageComponent, ToolExecutionComponent, CustomMessageComponent,
  CompactionSummaryMessageComponent, BranchSummaryMessageComponent, BashExecutionComponent,
  createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition, createBashToolDefinition,
  createPowerShellToolDefinition, createGrepToolDefinition, createFindToolDefinition, createLsToolDefinition,
  getMarkdownTheme, type SessionEntry, type ToolRenderers,
  truncateTail,
} from "@earendil-works/pi-coding-agent";
import { type Component, type TUI } from "@earendil-works/pi-tui";

/** Uses public Pi components, including paired calls/results, rather than extracting plain text. */
export class Transcript implements Component {
  private components: Component[] = [];
  private expanded = false;
  private thinking = false;
  private entries: SessionEntry[] = [];
  private builtins: Map<string, ToolRenderers>;
  private cache = new Map<string, { entry: SessionEntry; components: Component[]; calls: Map<string, ToolExecutionComponent> }>();
  private results = new WeakMap<ToolExecutionComponent, SessionEntry>();

  constructor(private tui: TUI, private cwd: string, private renderer?: (name: string) => ToolRenderers | undefined) {
    this.builtins = new Map([
      createReadToolDefinition(cwd), createWriteToolDefinition(cwd), createEditToolDefinition(cwd),
      createBashToolDefinition(cwd), createPowerShellToolDefinition(cwd), createGrepToolDefinition(cwd),
      createFindToolDefinition(cwd), createLsToolDefinition(cwd),
    // Pi's heterogeneous renderer API erases individual tool parameter types.
    ].map(tool => [tool.name, tool as unknown as ToolRenderers]));
  }
  setEntries(entries: SessionEntry[]): void { this.entries = entries; this.rebuild(); }
  toggleTools(): void { this.expanded = !this.expanded; this.cache.clear(); this.rebuild(); }
  toggleThinking(): void { this.thinking = !this.thinking; this.cache.clear(); this.rebuild(); }

  private rebuild(): void {
    const theme = getMarkdownTheme();
    const components: Component[] = [];
    const calls = new Map<string, ToolExecutionComponent>();
    const retained = new Set<string>();
    for (const entry of this.entries) {
      retained.add(entry.id);
      const cached = this.cache.get(entry.id);
      const result = entry.type === 'message' && entry.message.role === 'toolResult';
      // Canonical Pi entries are immutable after append. Streaming tails are fresh synthetic
      // entries, so their components update while stable Markdown/tools retain width caches.
      if (cached?.entry === entry && !result) {
        components.push(...cached.components); for (const [id, tool] of cached.calls) calls.set(id, tool);
        continue;
      }
      const start = components.length, ownCalls = new Map<string, ToolExecutionComponent>();
      const timestamp = Date.parse(entry.timestamp);
      if (entry.type === "compaction") {
        const component = new CompactionSummaryMessageComponent({ role: "compactionSummary", summary: entry.summary, tokensBefore: entry.tokensBefore, timestamp }, theme, 0);
        component.setExpanded(this.expanded); components.push(component);
      } else if (entry.type === "branch_summary") {
        const component = new BranchSummaryMessageComponent({ role: "branchSummary", summary: entry.summary, fromId: entry.fromId, timestamp }, theme, 0);
        component.setExpanded(this.expanded); components.push(component);
      } else if (entry.type === "custom_message" && entry.display) {
        components.push(new CustomMessageComponent({ ...entry, role: "custom", timestamp }, undefined, theme, 0));
      } else if (entry.type === "message") {
        const message = entry.message;
        if (message.role === "user") {
          const text = typeof message.content === "string" ? message.content : message.content
            .map(block => block.type === "text" ? block.text : "[image]").join("\n");
          components.push(new UserMessageComponent(text, theme, 0));
        } else if (message.role === "assistant") {
          components.push(new AssistantMessageComponent(message, !this.thinking, theme, undefined, 0));
          for (const block of message.content) {
            if (block.type !== "toolCall") continue;
            const tool = new ToolExecutionComponent(block.name, block.id, block.arguments, { showImages: false, outputPad: 0 }, this.renderer?.(block.name) ?? this.builtins.get(block.name), this.tui, this.cwd);
            if (!entry.id.startsWith('stream:')) { tool.setArgsComplete(); tool.markExecutionStarted(); }
            tool.setExpanded(this.expanded); ownCalls.set(block.id, tool);
            calls.set(block.id, tool); components.push(tool);
          }
        } else if (message.role === "toolResult") {
          let tool = calls.get(message.toolCallId);
          if (!tool) {
            // A branch can retain a result after its call was compacted away.
            tool = cached?.components[0] as ToolExecutionComponent | undefined ?? new ToolExecutionComponent(message.toolName, message.toolCallId, {}, { showImages: false, outputPad: 0 }, this.renderer?.(message.toolName) ?? this.builtins.get(message.toolName), this.tui, this.cwd);
            tool.setExpanded(this.expanded); components.push(tool);
          }
          if (this.results.get(tool) !== entry) { tool.updateResult(message, entry.id.startsWith('stream:')); this.results.set(tool, entry); }
        } else if (message.role === "custom" && message.display) {
          components.push(new CustomMessageComponent(message, undefined, theme, 0));
        } else if (message.role === "bashExecution") {
          const component = new BashExecutionComponent(message.command, this.tui, message.excludeFromContext, 0);
          component.appendOutput(message.output);
          component.setComplete(message.exitCode, message.cancelled, message.truncated ? { ...truncateTail(message.output), truncated: true } : undefined, message.fullOutputPath);
          component.setExpanded(this.expanded); components.push(component);
        }
      }
      this.cache.set(entry.id, { entry, components: components.slice(start), calls: ownCalls });
    }
    for (const id of this.cache.keys()) if (!retained.has(id)) this.cache.delete(id);
    this.components = components;
  }
  render(width: number): string[] { return this.components.flatMap(component => component.render(width)); }
  invalidate(): void { this.components.forEach(component => component.invalidate()); }
}
