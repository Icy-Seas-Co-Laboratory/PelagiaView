import test from 'node:test';
import assert from 'node:assert/strict';
import { scanModeMetadata } from '../src/lib/processing/lineScanGeometry';
import { pruneProcessingSettings } from '../src/lib/processing/settings';

test('line-scan ingestion records continuity geometry without changing source metadata', () => {
  const source = { campaign: 'alaska', line_scan: true };
  assert.deepEqual(scanModeMetadata(source, 'line_scan', 'y'), {
    campaign: 'alaska',
    line_scan_geometry: { scan_axis: 'y' }
  });
  assert.deepEqual(source, { campaign: 'alaska', line_scan: true });
});

test('area-scan ingestion removes stale line-scan geometry', () => {
  const source = { campaign: 'alaska', line_scan: true, line_scan_geometry: { scan_axis: 'x' } };
  assert.deepEqual(scanModeMetadata(source, 'area_scan', 'y'), { campaign: 'alaska' });
});

test('ingestion presets retain the independent continuity direction', () => {
  assert.deepEqual(
    pruneProcessingSettings({ ingestionScanMode: 'line_scan', ingestionLineScanAxis: 0, ingestionContinuityAxis: 'y' }),
    { ingestionScanMode: 'line_scan', ingestionLineScanAxis: 0, ingestionContinuityAxis: 'y' }
  );
});
