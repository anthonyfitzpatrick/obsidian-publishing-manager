/** Pure TPL-001–TPL-005 versioning, safety, import/export, and variable-resolution rules. */
export const TEMPLATE_PORTABLE_FORMAT = 'publishing-manager-template';
export const TEMPLATE_PORTABLE_SCHEMA = 1;
export const TEMPLATE_IMPORT_LIMIT_BYTES = 262_144;

export type PublishingTemplateKind =
  'book' | 'checklist' | 'edition' | 'launch' | 'metadata' | 'platform' | 'pricing' | 'task';
export type TemplateVariableType = 'boolean' | 'date' | 'integer' | 'number' | 'string';

export interface TemplateVariable {
  readonly name: string;
  readonly label: string;
  readonly type: TemplateVariableType;
  readonly required: boolean;
  readonly description?: string;
  readonly default?: unknown;
}
export interface PublishingTemplate {
  readonly templateId: string;
  readonly kind: PublishingTemplateKind;
  readonly name: string;
  readonly description?: string;
  readonly version: number;
  readonly applicability: Readonly<Record<string, unknown>>;
  readonly defaults: Readonly<Record<string, unknown>>;
  readonly requiredFields: readonly string[];
  readonly variables: readonly TemplateVariable[];
  readonly extensions?: Readonly<Record<string, unknown>>;
}
export interface TemplateResolutionPreview {
  readonly resolvedDefaults: Readonly<Record<string, unknown>>;
  readonly suppliedVariables: Readonly<Record<string, unknown>>;
  readonly unresolvedVariables: readonly string[];
  readonly missingRequiredFields: readonly string[];
  readonly warnings: readonly string[];
  readonly canApply: boolean;
}
export interface TemplateImportResult {
  readonly template: PublishingTemplate;
  readonly excludedPrivateFields: readonly string[];
}

const KINDS: readonly PublishingTemplateKind[] = [
  'book',
  'checklist',
  'edition',
  'launch',
  'metadata',
  'platform',
  'pricing',
  'task'
];
const VARIABLE_TYPES: readonly TemplateVariableType[] = [
  'boolean',
  'date',
  'integer',
  'number',
  'string'
];
const TOP_LEVEL_KEYS = new Set([
  'format',
  'schemaVersion',
  'templateId',
  'kind',
  'name',
  'description',
  'version',
  'applicability',
  'defaults',
  'requiredFields',
  'variables',
  'extensions'
]);
const PRIVATE_KEY =
  /(?:^|[-_])(body|credential|notes?|password|permission-notes|private|provenance|quote|secret|source-values|token)(?:$|[-_])/iu;
const EXECUTABLE_KEY =
  /(?:^|[-_])(command|endpoint|executable|fetch|request|script|shell|webhook)(?:$|[-_])/iu;
const TOKEN = /\{\{\s*([A-Za-z][A-Za-z0-9_-]{0,63})\s*\}\}/gu;
const EXACT_TOKEN = /^\{\{\s*([A-Za-z][A-Za-z0-9_-]{0,63})\s*\}\}$/u;

/** Parses untrusted JSON as bounded inert data, excludes private content, and preserves safe extensions. */
export function parseTemplateImport(source: string): TemplateImportResult {
  if (new TextEncoder().encode(source).byteLength > TEMPLATE_IMPORT_LIMIT_BYTES)
    throw new Error('Template import exceeds the 256 KiB limit.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('Template import must be valid JSON.');
  }
  const excluded: string[] = [];
  const safe = sanitize(parsed, '', excluded, 0);
  const root = object(safe, 'Template import must contain one object.');
  if (root.format !== TEMPLATE_PORTABLE_FORMAT)
    throw new Error(`Template format must be ${TEMPLATE_PORTABLE_FORMAT}.`);
  if (root.schemaVersion !== TEMPLATE_PORTABLE_SCHEMA)
    throw new Error(`Template schema version must be ${TEMPLATE_PORTABLE_SCHEMA}.`);
  const unknown = Object.fromEntries(
    Object.entries(root).filter(([key]) => !TOP_LEVEL_KEYS.has(key))
  );
  const extensions = { ...optionalObject(root.extensions), ...unknown };
  return {
    template: validateTemplate({
      templateId: requiredText(root.templateId, 'Template ID'),
      kind: requiredKind(root.kind),
      name: requiredText(root.name, 'Template name'),
      ...(optionalText(root.description) === undefined
        ? {}
        : { description: optionalText(root.description)! }),
      version: positiveInteger(root.version, 'Template version'),
      applicability: object(root.applicability, 'Template applicability must be an object.'),
      defaults: object(root.defaults, 'Template defaults must be an object.'),
      requiredFields: stringList(root.requiredFields, 'Template requiredFields'),
      variables: variableList(root.variables),
      ...(Object.keys(extensions).length === 0 ? {} : { extensions })
    }),
    excludedPrivateFields: [...new Set(excluded)].sort()
  };
}

/** Validates trusted bundled/user objects through the same inert-data limits as imports. */
export function validateTemplate(template: PublishingTemplate): PublishingTemplate {
  if (!KINDS.includes(template.kind)) throw new Error('Template kind is unsupported.');
  requiredText(template.templateId, 'Template ID');
  requiredText(template.name, 'Template name');
  positiveInteger(template.version, 'Template version');
  if (template.requiredFields.length > 64)
    throw new Error('Template has too many required fields.');
  if (new Set(template.requiredFields).size !== template.requiredFields.length)
    throw new Error('Template required fields must be unique.');
  if (template.variables.length > 64) throw new Error('Template has too many variables.');
  if (new Set(template.variables.map(({ name }) => name)).size !== template.variables.length)
    throw new Error('Template variable names must be unique.');
  for (const variable of template.variables) validateVariable(variable);
  sanitize(template.applicability, 'applicability', [], 0);
  sanitize(template.defaults, 'defaults', [], 0);
  if (template.extensions !== undefined) sanitize(template.extensions, 'extensions', [], 0);
  const tokenNames = collectTokens(template.defaults);
  const known = new Set(template.variables.map(({ name }) => name));
  const unknown = tokenNames.filter((name) => !known.has(name));
  if (unknown.length > 0)
    throw new Error(`Template uses undefined variables: ${unknown.join(', ')}.`);
  return template;
}

/** Resolves data tokens only; no string is evaluated, executed, fetched, or treated as a command. */
export function previewTemplateResolution(
  template: PublishingTemplate,
  supplied: Readonly<Record<string, unknown>>
): TemplateResolutionPreview {
  validateTemplate(template);
  const values: Record<string, unknown> = {};
  const unresolved: string[] = [];
  const warnings: string[] = [];
  const defined = new Set(template.variables.map(({ name }) => name));
  for (const key of Object.keys(supplied).sort())
    if (!defined.has(key)) warnings.push(`Ignored unknown variable ${key}.`);
  for (const variable of template.variables) {
    const raw = supplied[variable.name] ?? variable.default;
    if (raw === undefined || raw === '') {
      if (variable.required) unresolved.push(variable.name);
      continue;
    }
    values[variable.name] = normalizeVariableValue(variable, raw);
  }
  const resolved = resolveValue(template.defaults, values) as Readonly<Record<string, unknown>>;
  const missing = template.requiredFields.filter((field) => !hasRequiredField(resolved[field]));
  return {
    resolvedDefaults: resolved,
    suppliedVariables: values,
    unresolvedVariables: unresolved,
    missingRequiredFields: missing,
    warnings,
    canApply: unresolved.length === 0 && missing.length === 0
  };
}

/** Produces stable portable JSON without envelope, body, instance evidence, or private extensions. */
export function serializeTemplate(template: PublishingTemplate): {
  readonly source: string;
  readonly excludedPrivateFields: readonly string[];
} {
  validateTemplate(template);
  const excluded: string[] = [];
  const safe = sanitize(
    {
      format: TEMPLATE_PORTABLE_FORMAT,
      schemaVersion: TEMPLATE_PORTABLE_SCHEMA,
      templateId: template.templateId,
      kind: template.kind,
      name: template.name,
      ...(template.description === undefined ? {} : { description: template.description }),
      version: template.version,
      applicability: template.applicability,
      defaults: template.defaults,
      requiredFields: template.requiredFields,
      variables: template.variables,
      ...(template.extensions === undefined ? {} : { extensions: template.extensions })
    },
    '',
    excluded,
    0
  );
  return {
    source: `${JSON.stringify(sortKeys(safe), null, 2)}\n`,
    excludedPrivateFields: [...new Set(excluded)].sort()
  };
}

function validateVariable(variable: TemplateVariable): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(variable.name))
    throw new Error(`Template variable name ${variable.name} is invalid.`);
  requiredText(variable.label, `Variable ${variable.name} label`);
  if (!VARIABLE_TYPES.includes(variable.type))
    throw new Error(`Variable ${variable.name} has an unsupported type.`);
  if (variable.default !== undefined) normalizeVariableValue(variable, variable.default);
}
function normalizeVariableValue(variable: TemplateVariable, value: unknown): unknown {
  if (variable.type === 'string') {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
      throw new Error(`${variable.label} must be text.`);
    return String(value).trim();
  }
  if (variable.type === 'boolean') {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new Error(`${variable.label} must be true or false.`);
  }
  if (variable.type === 'integer') {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(number)) throw new Error(`${variable.label} must be a whole number.`);
    return number;
  }
  if (variable.type === 'number') {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number)) throw new Error(`${variable.label} must be a number.`);
    return number;
  }
  const date = String(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (match === null) throw new Error(`${variable.label} must use YYYY-MM-DD.`);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date)
    throw new Error(`${variable.label} must be a real date.`);
  return date;
}
function resolveValue(value: unknown, variables: Readonly<Record<string, unknown>>): unknown {
  if (typeof value === 'string') {
    const exact = EXACT_TOKEN.exec(value);
    if (exact !== null) return variables[exact[1]!] ?? value;
    return value.replace(TOKEN, (token, name: string) =>
      variables[name] === undefined ? token : scalarText(variables[name])
    );
  }
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, variables));
  if (isObject(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveValue(item, variables)])
    );
  return value;
}
function collectTokens(value: unknown): string[] {
  if (typeof value === 'string') return [...value.matchAll(TOKEN)].map((match) => match[1]!);
  if (Array.isArray(value)) return [...new Set(value.flatMap(collectTokens))].sort();
  if (isObject(value)) return [...new Set(Object.values(value).flatMap(collectTokens))].sort();
  return [];
}
function sanitize(value: unknown, path: string, excluded: string[], depth: number): unknown {
  if (depth > 12) throw new Error('Template data exceeds the maximum nesting depth.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    if (typeof value === 'string' && (/^\s*javascript:/iu.test(value) || /<script\b/iu.test(value)))
      throw new Error(`Template contains executable text at ${path || 'root'}.`);
    if (typeof value === 'string' && value.length > 20_000)
      throw new Error(`Template text is too long at ${path || 'root'}.`);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error(`Template number is invalid at ${path || 'root'}.`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 256) throw new Error(`Template list is too large at ${path || 'root'}.`);
    return value.map((item, index) => sanitize(item, `${path}[${index}]`, excluded, depth + 1));
  }
  if (!isObject(value)) throw new Error(`Template contains unsupported data at ${path || 'root'}.`);
  if (Object.keys(value).length > 256)
    throw new Error(`Template object has too many fields at ${path || 'root'}.`);
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (EXECUTABLE_KEY.test(key))
      throw new Error(`Executable template field is forbidden: ${nextPath}.`);
    if (PRIVATE_KEY.test(key)) {
      excluded.push(nextPath);
      continue;
    }
    result[key] = sanitize(item, nextPath, excluded, depth + 1);
  }
  return result;
}
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])])
  );
}
function variableList(value: unknown): readonly TemplateVariable[] {
  if (!Array.isArray(value)) throw new Error('Template variables must be a list.');
  return value.map((item, index) => {
    const variable = object(item, `Template variable ${index + 1} must be an object.`);
    const type = variable.type;
    if (typeof type !== 'string' || !VARIABLE_TYPES.includes(type as TemplateVariableType))
      throw new Error(`Template variable ${index + 1} type is unsupported.`);
    if (typeof variable.required !== 'boolean')
      throw new Error(`Template variable ${index + 1} required must be true or false.`);
    return {
      name: requiredText(variable.name, `Template variable ${index + 1} name`),
      label: requiredText(variable.label, `Template variable ${index + 1} label`),
      type: type as TemplateVariableType,
      required: variable.required,
      ...(optionalText(variable.description) === undefined
        ? {}
        : { description: optionalText(variable.description)! }),
      ...(!('default' in variable) ? {} : { default: variable.default })
    };
  });
}
function requiredKind(value: unknown): PublishingTemplateKind {
  if (typeof value !== 'string' || !KINDS.includes(value as PublishingTemplateKind))
    throw new Error('Template kind is unsupported.');
  return value as PublishingTemplateKind;
}
function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  if (value.trim().length > 200) throw new Error(`${label} is too long.`);
  return value.trim();
}
function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new Error(`${label} must be a positive whole number.`);
  return Number(value);
}
function stringList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim()))
    throw new Error(`${label} must be a list of non-empty strings.`);
  return value.map((item) => String(item).trim());
}
function object(value: unknown, message: string): Readonly<Record<string, unknown>> {
  if (!isObject(value)) throw new Error(message);
  return value;
}
function optionalObject(value: unknown): Readonly<Record<string, unknown>> {
  return isObject(value) ? value : {};
}
function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function hasRequiredField(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}
function scalarText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';
}
