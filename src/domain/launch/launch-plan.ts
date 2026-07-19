/** Pure LCH-001–LCH-006 template, date-only, preview, and critical-path contracts. */
export type LaunchReflowMode = 'all-unpinned' | 'future-incomplete' | 'anchor-only';
export type LaunchPreviewAction =
  'create' | 'update' | 'anchor-only' | 'preserve-complete' | 'preserve-pinned' | 'preserve-past';

export interface LaunchTemplateMilestone {
  readonly code: string;
  readonly label: string;
  readonly offsetDays: number;
  readonly workingDays: boolean;
  readonly stageCategory: string;
  readonly estimateMinutes: number;
  readonly dependsOn: readonly string[];
}
export interface LaunchTemplate {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly milestones: readonly LaunchTemplateMilestone[];
}
export interface LaunchPreviewRow {
  readonly code: string;
  readonly label: string;
  readonly proposedDate: string;
  readonly previousDate?: string;
  readonly action: LaunchPreviewAction;
  readonly conflict?: string;
  readonly past: boolean;
  readonly taskId?: string;
  readonly sourceRevision?: string;
}

export const DEFAULT_LAUNCH_TEMPLATE: LaunchTemplate = {
  id: 'pm-launch-standard',
  name: 'Standard publication launch',
  version: 1,
  milestones: [
    {
      code: 'L-90',
      label: 'Launch planning begins',
      offsetDays: -90,
      workingDays: false,
      stageCategory: 'planning',
      estimateMinutes: 120,
      dependsOn: []
    },
    {
      code: 'L-60',
      label: 'Metadata and positioning review',
      offsetDays: -60,
      workingDays: true,
      stageCategory: 'metadata-complete',
      estimateMinutes: 180,
      dependsOn: ['L-90']
    },
    {
      code: 'L-30',
      label: 'Retail and campaign readiness',
      offsetDays: -30,
      workingDays: true,
      stageCategory: 'retail-upload',
      estimateMinutes: 240,
      dependsOn: ['L-60']
    },
    {
      code: 'LAUNCH',
      label: 'Publication day',
      offsetDays: 0,
      workingDays: false,
      stageCategory: 'published',
      estimateMinutes: 60,
      dependsOn: ['L-30']
    },
    {
      code: 'L+14',
      label: 'Post-launch review',
      offsetDays: 14,
      workingDays: true,
      stageCategory: 'post-launch',
      estimateMinutes: 120,
      dependsOn: ['LAUNCH']
    }
  ]
};

/** Parses and formats in UTC so a date-only value cannot move across timezone boundaries. */
export function shiftDateOnly(value: string, offsetDays: number, workingDays: boolean): string {
  const date = parseDateOnly(value);
  const direction = offsetDays < 0 ? -1 : 1;
  let remaining = Math.abs(offsetDays);
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + direction);
    if (!workingDays || (date.getUTCDay() !== 0 && date.getUTCDay() !== 6)) remaining -= 1;
  }
  return formatDateOnly(date);
}

export function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value))
    throw new Error('Use a real YYYY-MM-DD publication date.');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month! - 1 ||
    date.getUTCDate() !== day
  )
    throw new Error('Use a real YYYY-MM-DD publication date.');
  return date;
}

function formatDateOnly(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** Longest dependency duration ending at each milestone; cycles are rejected explicitly. */
export function criticalPath(template: LaunchTemplate): readonly string[] {
  const byCode = new Map(template.milestones.map((item) => [item.code, item]));
  const visiting = new Set<string>();
  const memo = new Map<string, { minutes: number; path: readonly string[] }>();
  const visit = (code: string): { minutes: number; path: readonly string[] } => {
    const cached = memo.get(code);
    if (cached !== undefined) return cached;
    if (visiting.has(code)) throw new Error(`Launch template dependency cycle includes ${code}.`);
    const item = byCode.get(code);
    if (item === undefined) throw new Error(`Launch template dependency ${code} does not exist.`);
    visiting.add(code);
    const prior = item.dependsOn.map(visit).sort((a, b) => b.minutes - a.minutes)[0];
    visiting.delete(code);
    const result = {
      minutes: (prior?.minutes ?? 0) + item.estimateMinutes,
      path: [...(prior?.path ?? []), code]
    };
    memo.set(code, result);
    return result;
  };
  return (
    template.milestones.map(({ code }) => visit(code)).sort((a, b) => b.minutes - a.minutes)[0]
      ?.path ?? []
  );
}
