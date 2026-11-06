import { getSettingsListTheme, type ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { SettingsList, truncateToWidth } from '@earendil-works/pi-tui';
import type { TSchema } from 'typebox';
import { configSchema, defaults, loadConfig, readConfig, type SuiteConfig } from '../config.ts';
import { configField, configPaths, writeConfigFields, type ConfigLayer } from '../config-fields.ts';
import { selectValue } from '../../ui/select.ts';
import type { Dock } from '../../ui/dock.ts';

const describe = (value: unknown): string => value === undefined ? 'inherit' : JSON.stringify(typeof value === 'function' ? [] : value);
type FieldSchema = TSchema & { type?: string; enum?: string[] };
type Field = { path: string[]; schema: FieldSchema };
const fields: Field[] = Object.entries(configSchema.properties).flatMap(([section, schema]) =>
  Object.entries(schema.properties as Record<string, FieldSchema>).map(([field, schema]) => ({ path: [section, field], schema })));

async function editValue(ctx: ExtensionCommandContext, field: Field, current: unknown): Promise<{ value: unknown } | undefined> {
  const title = field.path.join('.');
  if (field.schema.type === 'boolean' || Array.isArray(field.schema.enum)) {
    const values = field.schema.type === 'boolean' ? ['true', 'false'] : field.schema.enum as string[];
    const choice = await selectValue(ctx, title, values.map(value => ({ value, label: value })), String(current));
    return choice === undefined ? undefined : { value: field.schema.type === 'boolean' ? choice === 'true' : choice };
  }
  if (field.schema.type === 'string' || field.schema.type === 'integer') {
    const choice = await ctx.ui.input(title, current === undefined ? '' : String(current));
    if (field.schema.type === 'integer' && choice !== undefined && !choice.trim()) throw new Error(`${title} requires an integer`);
    return choice === undefined ? undefined : { value: field.schema.type === 'integer' ? Number(choice) : choice };
  }
  const text = await ctx.ui.editor(`${title} · JSON`, JSON.stringify(current ?? (field.schema.type === 'object' ? {} : []), null, 2));
  return text === undefined ? undefined : { value: JSON.parse(text) as unknown };
}

export async function showSuiteSettings(ctx: ExtensionCommandContext, dock: Dock, config: () => SuiteConfig,
  types?: () => Promise<void>): Promise<void> {
  if (ctx.mode !== 'tui') {
    const saved = loadConfig(ctx.cwd);
    ctx.ui.notify(JSON.stringify({ ...saved, jobs: { ...saved.jobs, launchPolicy: readConfig(configPaths(ctx.cwd).user).jobs?.launchPolicy ?? [] } }, null, 2));
    return;
  }
  let initial: string | undefined;
  for (;;) {
    const saved = loadConfig(ctx.cwd), paths = configPaths(ctx.cwd);
    const layers = { user: readConfig(paths.user), project: readConfig(paths.project) };
    const effective = (field: Field) => field.path.join('.') === 'jobs.launchPolicy'
      ? layers.user.jobs?.launchPolicy ?? [] : configField(saved, field.path);
    const items = fields.map(field => {
      const source = configField(layers.project, field.path) !== undefined ? 'project'
        : configField(layers.user, field.path) !== undefined ? 'user' : 'default';
      const active = configField(config(), field.path);
      return { id: field.path.join('.'), label: field.path.join(' · '), currentValue: describe(effective(field)), values: ['Edit…'],
        description: `Source: ${source}\nDefault: ${describe(configField(defaults, field.path))}\nUser: ${describe(configField(layers.user, field.path))}\nProject: ${describe(configField(layers.project, field.path))}\n${field.path[0] === 'modules' || field.path[0] === 'commands' ? `Active: ${describe(active)}\n` : ''}Save changes, then /reload to apply.` };
    });
    dock.setDetail(true);
    let selected: string | undefined;
    try {
      selected = await ctx.ui.custom<string | undefined>((tui, _theme, _keys, done) => {
        const list = new SettingsList(items, Math.max(1, Math.floor(tui.terminal.rows * 0.7) - 5), getSettingsListTheme(), id => done(id), () => done(undefined), { enableSearch: true });
        if (initial) list.selectItem(initial);
        return { render: width => [truncateToWidth('Pi Suite · saved settings · /reload applies changes', width), ...list.render(width)],
          invalidate: () => list.invalidate(), handleInput: data => { list.handleInput(data); tui.requestRender(); }, handleMouse: event => list.handleMouse({ ...event, y: event.y - 1 }) };
      });
    } finally { dock.setDetail(false); }
    if (selected === undefined) return;
    initial = selected;
    const field = fields.find(field => field.path.join('.') === selected)!;
    const userOnly = selected === 'jobs.launchPolicy';
    const actions = [{ value: 'edit:user', label: 'Edit user value' }, ...userOnly ? [] : [{ value: 'edit:project', label: 'Edit project value' }],
      { value: 'clear:user', label: 'Restore user inheritance' }, ...userOnly ? [] : [{ value: 'clear:project', label: 'Restore project inheritance' }],
      ...selected === 'agents.types' && types ? [{ value: 'types', label: 'Agent types · models / thinking' }] : []];
    const source = configField(layers.project, field.path) === undefined ? 'user' : 'project';
    const action = await selectValue(ctx, `${selected} · saved ${describe(effective(field))}`, actions, `edit:${source}`);
    if (action === undefined) continue;
    if (action === 'types') { await types!(); continue; }
    const [operation, layer] = action.split(':') as ['edit' | 'clear', ConfigLayer];
    try {
      const change = operation === 'clear' ? { value: undefined } : await editValue(ctx, field, configField(layers[layer], field.path) ?? effective(field));
      if (!change) continue;
      await writeConfigFields(ctx.cwd, [{ ...change, path: field.path, layer }]);
      const value = configField(loadConfig(ctx.cwd), field.path);
      ctx.ui.notify(`${selected} saved to ${paths[layer]} · effective ${describe(typeof value === 'function' ? readConfig(paths.user).jobs?.launchPolicy ?? [] : value)} · /reload to apply`);
    } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error'); }
  }
}
