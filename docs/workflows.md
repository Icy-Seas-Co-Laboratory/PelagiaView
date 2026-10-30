# Operator workflows

[Documentation index](index.md) · [Repository overview](../README.md)

PelagiaView groups pages by the work an operator needs to complete.

| Area | Use it for |
| --- | --- |
| Status | Queue snapshots, processing submissions, worker health, KV status, pause/resume/retry, and worker shutdown where supported. |
| Ingestion | Analyze server-side videos, image sequences, and interchange datasets, then queue reviewed assets. |
| Telemetry | Analyze CSV sensor files, map columns to controlled units, preview values, and queue run-scoped imports. |
| Preprocessing, Segmentation, ROI Refinement | Submit criteria-based processing work; requests are planned asynchronously and remain visible in System status. |
| Explorer | Preview source frames and overlays, and run live preprocessing, segmentation, or refinement. |
| ROI Browser | Filter and review candidate/refined ROIs, masks, measurements, and frame context. See the [ROI Browser screenshot](../docs/assets/roi-browser.jpg). |
| Curation | Review model evidence, manage project labels, and record explicit human annotations. |
| Registry | Inspect and edit project-scoped Oracle Dataset revisions at `/registry/`. |
| Exports | Create reproducible, project-scoped bundles for selected ROIs, review filters, or telemetry runs. |
| Event Log | Search merged job and application events by stage, status, run, worker, level, and source. |

Processing submissions return immediately and are planned in the backend. A submitted request is not evidence that every matching job has completed; use Status and the queue views to follow the authoritative state.
