/**
 * Proves UI-007 keyboard tab behavior independently of DOM focus implementation. Arrow keys wrap,
 * Home/End jump predictably, and persisted state accepts only implemented enabled tabs.
 */

import { describe, expect, it } from 'vitest';

import { isWorkspaceTab, nextWorkspaceTab } from '../../src/ui/view-models/workspace-navigation';

describe('workspace keyboard navigation', () => {
  it('wraps arrow navigation across enabled tabs', () => {
    expect(nextWorkspaceTab('overview', 'ArrowRight')).toBe('editions');
    expect(nextWorkspaceTab('editions', 'ArrowRight')).toBe('diagnostics');
    expect(nextWorkspaceTab('diagnostics', 'ArrowRight')).toBe('overview');
    expect(nextWorkspaceTab('overview', 'ArrowLeft')).toBe('diagnostics');
  });

  it('supports Home and End and rejects unavailable persisted tabs', () => {
    expect(nextWorkspaceTab('diagnostics', 'Home')).toBe('overview');
    expect(nextWorkspaceTab('overview', 'End')).toBe('diagnostics');
    expect(isWorkspaceTab('overview')).toBe(true);
    expect(isWorkspaceTab('editions')).toBe(true);
    expect(isWorkspaceTab('workflow')).toBe(false);
  });
});
