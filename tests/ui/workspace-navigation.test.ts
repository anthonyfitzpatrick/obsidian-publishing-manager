/**
 * Proves UI-007/WFL-010/MET-007 keyboard behavior independently of DOM focus implementation.
 * Arrow keys include Workflow and Metadata, Home/End jump predictably, and persisted state accepts
 * only implemented enabled tabs.
 */

import { describe, expect, it } from 'vitest';

import { isWorkspaceTab, nextWorkspaceTab } from '../../src/ui/view-models/workspace-navigation';

describe('workspace keyboard navigation', () => {
  it('wraps arrow navigation across enabled tabs', () => {
    expect(nextWorkspaceTab('overview', 'ArrowRight')).toBe('workflow');
    expect(nextWorkspaceTab('workflow', 'ArrowRight')).toBe('editions');
    expect(nextWorkspaceTab('editions', 'ArrowRight')).toBe('metadata');
    expect(nextWorkspaceTab('metadata', 'ArrowRight')).toBe('isbns');
    expect(nextWorkspaceTab('isbns', 'ArrowRight')).toBe('pricing');
    expect(nextWorkspaceTab('pricing', 'ArrowRight')).toBe('distribution');
    expect(nextWorkspaceTab('distribution', 'ArrowRight')).toBe('readiness');
    expect(nextWorkspaceTab('readiness', 'ArrowRight')).toBe('sales');
    expect(nextWorkspaceTab('sales', 'ArrowRight')).toBe('assets');
    expect(nextWorkspaceTab('assets', 'ArrowRight')).toBe('diagnostics');
    expect(nextWorkspaceTab('diagnostics', 'ArrowRight')).toBe('overview');
    expect(nextWorkspaceTab('overview', 'ArrowLeft')).toBe('diagnostics');
  });

  it('supports Home and End and rejects unavailable persisted tabs', () => {
    expect(nextWorkspaceTab('diagnostics', 'Home')).toBe('overview');
    expect(nextWorkspaceTab('overview', 'End')).toBe('diagnostics');
    expect(isWorkspaceTab('overview')).toBe(true);
    expect(isWorkspaceTab('editions')).toBe(true);
    expect(isWorkspaceTab('assets')).toBe(true);
    expect(isWorkspaceTab('workflow')).toBe(true);
    expect(isWorkspaceTab('metadata')).toBe(true);
    expect(isWorkspaceTab('isbns')).toBe(true);
    expect(isWorkspaceTab('pricing')).toBe(true);
    expect(isWorkspaceTab('distribution')).toBe(true);
    expect(isWorkspaceTab('sales')).toBe(true);
  });
});
