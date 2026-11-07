import { toolRenderers, stateLine, type ToolLine } from '../../ui/tool-render.ts';

/** Live progress enriches the same renderer used before a workflow manager exists. */
export function workflowRenderers(progress?: {
  line(id: string): ToolLine | undefined;
  lines(id: string): string[] | undefined;
}) {
  return toolRenderers<{ name?: string; scriptPath?: string }, { id: string; status: string }>({
    call: args => ({ icon: '⟳', tone: 'accent', title: 'Workflow', summary: args.name ?? args.scriptPath ?? 'inline script' }),
    collapsed: details => progress?.line(details.id) ?? {
      ...stateLine(details.status), title: 'Workflow', summary: `${details.id} · ${details.status}`,
    },
    expanded: (details, _args, text) => progress?.lines(details.id) ?? [text],
  });
}
