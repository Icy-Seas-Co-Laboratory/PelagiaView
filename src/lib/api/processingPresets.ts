import { base } from '$app/paths';
import type { ProcessingPreset, ProcessingPresetSaveRequest } from '$lib/processing/settings';

const processingPresetsPath = `${base}/processing-presets`;

export async function listProcessingPresets(): Promise<ProcessingPreset[]> {
  const response = await fetch(processingPresetsPath);
  if (!response.ok) throw new Error(await presetErrorMessage(response));
  const payload = (await response.json()) as { presets?: ProcessingPreset[] };
  return payload.presets ?? [];
}

export async function saveProcessingPreset(request: ProcessingPresetSaveRequest): Promise<ProcessingPreset> {
  const response = await fetch(processingPresetsPath, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request)
  });
  if (!response.ok) throw new Error(await presetErrorMessage(response));
  const payload = (await response.json()) as { preset?: ProcessingPreset };
  if (!payload.preset) throw new Error('Preset save did not return a preset.');
  return payload.preset;
}

async function presetErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown; message?: unknown };
    return String(payload.error ?? payload.message ?? `Preset request failed with HTTP ${response.status}.`);
  } catch {
    return `Preset request failed with HTTP ${response.status}.`;
  }
}
