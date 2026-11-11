import { fauxAssistantMessage, fauxToolCall, type TranscriptContext } from '@earendil-works/pi-ai';

const resultText = (context: TranscriptContext) => {
  const result = context.messages.findLast(message => message.role === 'toolResult');
  return result?.content.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '';
};

/** Every task tool result starts with the generation a model must quote back. */
export function taskGeneration(context: TranscriptContext): string {
  const text = resultText(context);
  const generation = /^generation: (.+)$/m.exec(text)?.[1];
  if (!generation) throw new Error(`Expected a task generation in the last tool result: ${text}`);
  return generation;
}

/** A model turn that references tasks: it reads the live generation from the transcript. */
export const taskCall = (name: string, params: (generation: string) => Record<string, unknown>) =>
  (context: TranscriptContext) => fauxAssistantMessage(fauxToolCall(name, params(taskGeneration(context)) as Parameters<typeof fauxToolCall>[1]));

/** The first task turn of a list must discover its generation. */
export const listTasks = () => fauxAssistantMessage(fauxToolCall('task_list', {}));
