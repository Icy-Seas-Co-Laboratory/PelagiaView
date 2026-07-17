import maskAugmentation from './mask-augmentation.md?raw';
import refinementModels from './refinement-models.md?raw';
import roiStorage from './roi-storage.md?raw';
import thresholdMethods from './threshold-methods.md?raw';

export type HelpTopicId =
  | 'threshold-methods'
  | 'mask-augmentation'
  | 'roi-storage'
  | 'refinement-models';

export type HelpTopic = {
  id: HelpTopicId;
  title: string;
  markdown: string;
};

export const helpTopics: Record<HelpTopicId, HelpTopic> = {
  'threshold-methods': {
    id: 'threshold-methods',
    title: 'Threshold Methods',
    markdown: thresholdMethods
  },
  'mask-augmentation': {
    id: 'mask-augmentation',
    title: 'Mask Augmentation',
    markdown: maskAugmentation
  },
  'roi-storage': {
    id: 'roi-storage',
    title: 'ROI Payload Storage',
    markdown: roiStorage
  },
  'refinement-models': {
    id: 'refinement-models',
    title: 'ROI Refinement Models',
    markdown: refinementModels
  }
};
