import { getAgentDir, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { loadConfig } from './config.ts';
import { SessionBinding } from './binding.ts';
import { Notifications } from './notifications.ts';
import { Dock } from '../ui/dock.ts';
import { StatusPublisher } from '../ui/status.ts';
import { AskManager, registerAsk } from '../ask/index.ts';
import { WaitRegistry, registerWait } from './wait.ts';
import { recordsIn } from '../agents/records.ts';
import { visibleAgent, type AgentType } from '../agents/types.ts';
import { registerSuiteCommand } from './settings/index.ts';
import { prepareClipboard } from './clipboard.ts';
import type { SubagentsDeps } from '../agents/commands.ts';

export async function createSuite(pi: ExtensionAPI, initial: ExtensionContext) {
  let config = loadConfig(initial.cwd);
  // Pi uses Jiti with shared dependency graphs: concurrent imports can expose unfinished
  // exports. Load admitted stacks in order and finish registration before session_start returns.
  const [taskApi, goalApi, jobApi, agentApi] = [
    config.modules.tasks ? [await import('../tasks/index.ts'), await import('../tasks/tools.ts'), await import('../tasks/commands.ts')] as const : undefined,
    config.modules.goal ? [await import('../goal/manager.ts'), await import('../goal/tools.ts'), await import('../goal/commands.ts'), await import('../goal/index.ts')] as const : undefined,
    config.modules.jobs || config.modules.agents ? [await import('../jobs/index.ts'), await import('../jobs/tools.ts'), await import('../jobs/commands.ts')] as const : undefined,
    config.modules.agents ? [await import('../agents/index.ts'), await import('../agents/tools.ts'), await import('../agents/commands.ts'),
      await import('../agents/mentions/index.ts'), await import('../agents/schedules/index.ts'), await import('../agents/rpc/index.ts'),
      await import('../agents/workflow/index.ts'), await import('../agents/workflow/tools.ts'), await import('../agents/catalog.ts')] as const : undefined,
  ] as const;
  let cachedTypes: AgentType[] | undefined;
  const catalog = (ctx: ExtensionContext, fresh = false): AgentType[] => {
    if (fresh) cachedTypes = undefined;
    return cachedTypes ??= agentApi![8].agentTypes(ctx.cwd, getAgentDir(), { trusted: ctx.isProjectTrusted(),
      packageGate: config.agents.packageAgents, typeSettings: config.agents.types });
  };
  const binding = new SessionBinding();
  const dock = new Dock();
  const status = new StatusPublisher(dock);
  const notifications = new Notifications(pi, binding);
  // Disabled recovery must not load its protocol classifier or request-state machinery.
  // Enabled registration still completes before binding, so the first request is covered.
  const recovery = config.runtime.openAIResponsesAutoRecovery
    ? (await import('./responses/index.ts')).registerResponsesRecovery(pi, binding, true) : undefined;
  const tasks = config.modules.tasks ? new taskApi![0].TasksModule(binding, dock) : undefined;
  if (tasks) {
    taskApi![1].registerTaskTools(pi, tasks); taskApi![2].registerTasksCommand(pi, tasks, dock, notifications, binding); tasks.registerReminders(pi, () => config, notifications);
    dock.setOpen('tasks', async (rowId, ctx) => {
      const current = binding.current;
      if (!current) return;
      const release = notifications.hold();
      try {
        const { showTask } = await import('../tasks/viewer.ts');
        if (!binding.isCurrent(current) || ctx.signal?.aborted) return;
        await showTask(ctx, tasks, dock, rowId.slice('task:'.length), binding);
      } finally { release(); }
    });
  }
  const waits = new WaitRegistry();
  const goal = config.modules.goal ? new goalApi![0].GoalManager(pi, binding, notifications, status, waits) : undefined;
  const ask = config.modules.ask ? new AskManager(binding, notifications, dock, (status, ctx) => goal?.askResult(status, ctx)) : undefined;
  if (ask) registerAsk(pi, ask, () => config);
  const creatorRoots = () => {
    const ctx = binding.current?.ctx;
    if (!ctx) return [];
    // Module switches remove tools, while saved parent records still identify jobs
    // left by their children. Reading these references does not start an agent runtime.
    return agents ? agents.visibleRunIds(ctx) : recordsIn(ctx.sessionManager.getBranch())
      .filter(record => visibleAgent(record, {ctx})).map(record => record.runId);
  };
  const jobs = config.modules.jobs ? new jobApi![0].JobsModule(pi, binding, notifications, status, creatorRoots) : undefined;
  const jobViewer = jobs ? { jobs, dock, notifications, keys: () => config.jobs } : undefined;
  if (jobs) {
    jobApi![1].registerJobTools(pi, jobs, jobViewer!, { config: () => config, tasks }); jobApi![2].registerJobsCommand(pi, jobViewer!); waits.register(jobs);
  }
  const agents = config.modules.agents ? new agentApi![0].AgentsModule(pi, binding, notifications, status, tasks) : undefined;
  const agentJobViewer = agents ? {pi, viewer: jobViewer ?? {jobs: new jobApi![0].JobsModule(pi, binding, notifications, status, creatorRoots), dock, notifications, keys: () => config.jobs}} : undefined;
  const schedules = agents ? new agentApi![4].AgentScheduler(pi, binding, agents, notifications, () => config) : undefined;
  const agentRpc = agents ? new agentApi![5].AgentRpc(pi, binding, agents, () => config) : undefined;
  const workflows = agents ? new agentApi![6].WorkflowsModule(pi, binding, notifications, dock, agents) : undefined;
  const workflowTool = workflows && agents ? agentApi![7].registerWorkflowTool(pi, workflows, agents, () => config, catalog) : undefined;
  if (workflows) waits.register(workflows);
  let startTool: ReturnType<typeof import("../agents/tools.ts").registerAgentTools> | undefined;
  let mentions: ReturnType<typeof import("../agents/mentions/index.ts").registerAgentMentions> | undefined;
  let subagentsDeps: SubagentsDeps | undefined;
  if (agents) {
    startTool = agentApi![1].registerAgentTools(pi, agents, waits, () => config, schedules, agentJobViewer!.viewer.jobs);
    const reload = (cwd: string) => {
      config = loadConfig(cwd); cachedTypes = undefined; mentions?.refreshTypes();
      if (binding.current) workflowTool?.refreshTypes(binding.current.ctx);
    };
    subagentsDeps = { agents, dock, notices: notifications, config: () => config, reload, scheduler: schedules,
      workflows: workflows && workflowTool ? { available: () => workflowTool.enabled,
        show: async (ctx, page) => { const { showWorkflows } = await import('../agents/workflow/ui/menu.ts');
          await showWorkflows(ctx, { workflows, agents, dock, config: () => config, jobs: agentJobViewer }, page); } } : undefined,
      jobs: agentJobViewer };
    agentApi![2].registerSubagentsCommand(pi, subagentsDeps); waits.register(agents);
    mentions = agentApi![3].registerAgentMentions(pi, agents, binding, () => config, startTool, catalog);
  }
  if (jobs || agents) {
    registerWait(pi, waits);
    // Extension-sent messages (our own notices) are not the user and must not end a wait.
    pi.on("input", event => { if (event.streamingBehavior === "steer" && event.source !== "extension") waits.userSteered(); });
    pi.on("message_start", event => { if (event.message.role === "user") waits.steeringDelivered(); });
  }
  if (goal) {
    goalApi![1].registerGoalTools(pi, goal); goalApi![2].registerGoalCommand(pi, goal, dock, notifications); goalApi![3].registerGoalLifecycle(pi, goal);
  }

  if (agents) dock.setOpen('agents', async (rowId, ctx) => {
    const current = binding.current!;
    const { showAgent } = await import('../agents/viewer.ts');
    if (!binding.isCurrent(current)) return;
    const runId = rowId.slice('agent:'.length), record = agents.manager.records().find(record => record.runId === runId)!;
    const release = notifications.hold();
    try { await showAgent(ctx, agents, dock, record.id, runId, () => config, false, agentJobViewer); }
    finally { release(); }
  });
  if (workflows && agents) dock.setOpen('workflows', async (id, ctx) => {
    const current = binding.current!;
    const { showWorkflow } = await import('../agents/workflow/ui/menu.ts');
    if (!binding.isCurrent(current)) return;
    const release = notifications.hold();
    try { await showWorkflow(ctx, { workflows, agents, dock, config: () => config, jobs: agentJobViewer }, workflows.manager.get(id)); }
    finally { release(); }
  });
  if (jobs) dock.setOpen('jobs', async (id, ctx) => {
    const current = binding.current!;
    const { jobActions } = await import('../jobs/viewer.ts');
    if (!binding.isCurrent(current)) return;
    await jobActions(pi, ctx, jobViewer!, id, false, jobs.control().peek(id).cwd);
  });

  let firstBinding = true;
  const bindSession = async (ctx: Parameters<SessionBinding["bind"]>[0], reason: "startup" | "reload" | "new" | "resume" | "fork", previousSessionFile?: string) => {
    // Tree navigation has no shutdown event. Revoke the old readers and timers before
    // rebinding, without appending their state into the branch the host just selected.
    dock.detach(binding.current?.ctx);
    schedules?.stop(); ask?.cancel(); goal?.detach(); jobs?.detach(); workflows?.detach(); agents?.detach(); notifications.detach();
    if (!firstBinding) config = loadConfig(ctx.cwd);
    const goalReason = firstBinding ? reason : "tree";
    firstBinding = false; cachedTypes = undefined;
    await prepareClipboard(pi, ctx);
    binding.bind(ctx);
    recovery?.reset(ctx);
    dock.bind(ctx, config.ui.maxRows);
    status.bind(ctx.ui, { goal: config.goal.display, agents: config.agents.display, jobs: config.jobs.display }, goal !== undefined);
    await goal?.restore(ctx, goalReason);
    await tasks?.bind(ctx, { reason, previousSessionFile });
    agents?.manager.configure(config); agents?.bind();
    jobs?.bind();
    workflows?.bind(); workflowTool?.bind(ctx);
    await schedules?.bind(); startTool?.refreshSchema(); mentions?.bind(ctx);
    agentRpc?.bind();
    notifications.flush();
  };
  pi.on("session_tree", async (_event, ctx) => { await bindSession(ctx, "resume"); notifications.afterHostOperation(); });
  pi.on("session_shutdown", async event => {
    agentRpc?.detach();
    schedules?.stop();
    ask?.cancel(); await goal?.shutdown(event.reason);
    tasks?.detach();
    // Detach before revoking so pending job notices are cancelled under the old session ID.
    (jobs ?? agentJobViewer?.viewer.jobs)?.detach();
    // Module switches change registration, not the lifetime of existing execution owners.
    const agentDir = getAgentDir();
    const { quitExistingRuntime } = await import('../jobs/runtime.ts');
    const { quitExistingAgentRuntime } = await import('../agents/runtime.ts');
    const { quitExistingWorkflowRuntime } = await import('../agents/workflow/manager.ts');
    const quit = event.reason === 'quit' ? quitExistingRuntime(agentDir) : undefined;
    const agentQuit = event.reason === 'quit' ? quitExistingAgentRuntime(agentDir) : undefined;
    const workflowQuit = event.reason === 'quit' ? quitExistingWorkflowRuntime(agentDir) : undefined;
    const scheduleQuit = agentQuit?.then(() => schedules?.drain());
    workflows?.detach(); agents?.detach();
    recovery?.reset();
    notifications.detach(); status.detach(); dock.detach(binding.current?.ctx); binding.revoke();
    return Promise.all([quit, agentQuit, workflowQuit, scheduleQuit]).then(() => { if (agents) pi.events.emit('subagents:disposed', {}); });
  });
  pi.on("agent_before_settle", async event => {
    const repair = recovery?.beforeSettle(event);
    const proposed = repair ? { ...event, ...repair } : event;
    await goal?.beforeSettle(proposed);
    return notifications.beforeSettle(proposed) ?? repair;
  });
  pi.on("agent_settled", async event => {
    recovery?.settled();
    waits.steeringDelivered(); await goal?.settled(event.aborted);
    if (event.aborted) jobs?.pauseWakes();
    notifications.flush();
  });
  registerSuiteCommand(pi, dock, notifications, () => config, subagentsDeps ? async ctx => {
    const { showSubagents } = await import('../agents/ui/index.ts');
    await showSubagents('types', ctx, subagentsDeps!);
  } : undefined);
  return bindSession;
}
