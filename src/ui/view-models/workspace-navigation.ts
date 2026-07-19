/**
 * Defines the enabled M3 workspace tabs and deterministic keyboard movement. Future tabs remain
 * visible as unavailable context but never enter the focus sequence until their milestones ship.
 */

/** Tabs backed by implemented data rather than placeholders pretending to be functional. */
export const ENABLED_WORKSPACE_TABS = [
  'overview',
  'workflow',
  'editions',
  'metadata',
  'isbns',
  'pricing',
  'assets',
  'diagnostics'
] as const;

/** Enabled workspace tab identifier persisted in Obsidian view state. */
export type WorkspaceTab = (typeof ENABLED_WORKSPACE_TABS)[number];

/** Returns the next enabled tab for arrow/home/end keys, wrapping at both ends. */
export function nextWorkspaceTab(
  current: WorkspaceTab,
  key: 'ArrowLeft' | 'ArrowRight' | 'End' | 'Home'
): WorkspaceTab {
  if (key === 'Home') return 'overview';
  if (key === 'End') return 'diagnostics';
  const index = ENABLED_WORKSPACE_TABS.indexOf(current);
  const offset = key === 'ArrowRight' ? 1 : -1;
  const next = (index + offset + ENABLED_WORKSPACE_TABS.length) % ENABLED_WORKSPACE_TABS.length;
  return ENABLED_WORKSPACE_TABS[next] ?? 'overview';
}

/** Narrows restored workspace state without trusting arbitrary persisted strings. */
export function isWorkspaceTab(value: unknown): value is WorkspaceTab {
  return typeof value === 'string' && (ENABLED_WORKSPACE_TABS as readonly string[]).includes(value);
}
