import { json, type RequestHandler } from '@sveltejs/kit';
import {
  listServerProcessingPresets,
  saveServerProcessingPreset
} from '$lib/server/processingPresets';

export const GET: RequestHandler = async () => {
  const presets = await listServerProcessingPresets();
  return json({ presets });
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const payload = await request.json();
    const preset = await saveServerProcessingPreset(payload);
    return json({ preset });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
};

