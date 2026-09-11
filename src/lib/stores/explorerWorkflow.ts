import { writable } from 'svelte/store';
import type { ExplorerStage } from '$lib/utils/dashboardNavigation';

export type ExplorerStageAvailability = 'locked' | 'ready' | 'complete';
export type ExplorerWorkflowState = Record<ExplorerStage, ExplorerStageAvailability>;

export const initialExplorerWorkflow: ExplorerWorkflowState = {
  preprocessing: 'ready',
  threshold: 'locked',
  detection: 'locked',
  refinement: 'locked'
};

export const explorerWorkflow = writable<ExplorerWorkflowState>(initialExplorerWorkflow);
