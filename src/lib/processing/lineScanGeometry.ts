export type ContinuityScanAxis = 'x' | 'y';
export type IngestionScanMode = 'area_scan' | 'line_scan';

/** The selected acquisition mode is authoritative for continuity metadata. */
export function scanModeMetadata(
  source: Record<string, unknown>,
  mode: IngestionScanMode,
  scanAxis: ContinuityScanAxis
): Record<string, unknown> {
  const metadata = { ...source };
  if (mode === 'line_scan') {
    metadata.line_scan_geometry = { scan_axis: scanAxis };
    delete metadata.line_scan;
  } else {
    delete metadata.line_scan_geometry;
    delete metadata.line_scan;
  }
  return metadata;
}
