import { toolRenderers, stateLine, type ToolExpandedRow, type ToolLine } from '../../ui/tool-render.ts';

/** Live progress enriches the same renderer used before a workflow manager exists. */
export function workflowRenderers(progress?: {
  line(id: string): ToolLine | undefined;
  lines(id: string): ToolExpandedRow[] | undefined;
}) {
  return toolRenderers<{ name?: string; scriptPath?: string; script?: string }, { id: string; status: string; scriptPath?: string; resultPath?: string }>({
    call: args => ({ icon: '⟳', tone: 'accent', title: 'Workflow', summary: args.name ?? args.scriptPath ?? 'inline script' }),
    collapsed: details => progress?.line(details.id) ?? {
      ...stateLine(details.status), title: 'Workflow', summary: `${details.id} · ${details.status}`,
    },
    expanded: (details, args, text) => [
      ...args.script ? [{ code: args.script, language: 'javascript' as const, label: 'script' }] : [],
      ...details.scriptPath ? [{ label: 'scriptPath', value: details.scriptPath }] : [],
      ...details.resultPath ? [{ label: 'resultPath', value: details.resultPath }] : [],
      ...progress?.lines(details.id) ?? [text],
    ],
  });
}
