# PelagiaView

PelagiaView is a SvelteKit interface for working with a running Pelagia backend. It is intentionally focused on operational workflows: connecting to a backend session, monitoring queue and worker status, queueing processing work, exploring frames and ROIs, and reviewing logs/events.

The integrated Registry workspace is available at `/registry/`. It uses the
same Pelagia session and active project as the rest of the application and
calls Pelagia's `/registry/*` API rather than a separate Registry backend.
PelagiaView is the canonical Registry UI; the standalone Registry repository is
the lightweight SQLite-only deployment and should receive deliberate ports of
this interface rather than evolving an independent networked UI.

## Requirements

- Node.js 18 or newer
- npm
- A running Pelagia backend API

The default UI session endpoint is:

```bash
http://127.0.0.1:8000
```

You may also enter `127.0.0.1:8000`; PelagiaView will normalize it to `http://127.0.0.1:8000`.

## Start The Backend

From the sibling `Pelagia` repository, start the API using the backend workflow you normally use. For local development, the existing project script is the easiest path when you want the backend stack:

```bash
cd ../Pelagia
./scripts/pelagia_dev_stack.sh start
```

If you run the API manually, make sure it is reachable at the endpoint you plan to enter in PelagiaView. The UI currently expects the Pelagia HTTP API routes under the server root, such as `/health`, `/system/status`, `/jobs`, and `/assets`.

For a TOML-defined worker stack:

```bash
cd ../Pelagia
./scripts/pelagia_stack_from_toml.sh start scripts/pelagia_workers.toml
```

On shared machines, use a writable run directory:

```bash
PELAGIA_RUN_DIR=/scratch/Pelagia/.pelagia/run/dev-workers \
./scripts/pelagia_stack_from_toml.sh start scripts/pelagia_workers.toml
```

## Start PelagiaView

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev -- --port 5173
```

Open `http://127.0.0.1:5173/` for the default root-path development build.

For access from other machines on the network:

```bash
npm run dev -- --host 0.0.0.0 --port 5173
```

### Reverse-proxy path prefixes

PelagiaView can be built beneath a non-root URL and can default to a prefixed
Pelagia API endpoint:

```bash
PELAGIAVIEW_BASE_PATH=/pelagiaview \
PUBLIC_PELAGIA_API_URL=https://demo.pelagia.studio/pelagia-api \
npm run build

PELAGIAVIEW_BASE_PATH=/pelagiaview \
PUBLIC_PELAGIA_API_URL=https://demo.pelagia.studio/pelagia-api \
npm run preview -- --port 5173
```

Both values should omit a trailing slash. Because these settings affect the
generated application paths, rebuild PelagiaView after changing them.

Open the prefixed build at:

```bash
http://127.0.0.1:5173/pelagiaview/
```

Build for production:

```bash
npm run build
```

The production build uses SvelteKit's Node adapter. A Docker image and the
combined Pelagia, PelagiaView, and Oracle Builder deployment instructions are
in [Pelagia's Docker guide](../Pelagia/deploy/docker/README.md).

Run Svelte diagnostics:

```bash
npm run check
```

## Session Flow

1. Open PelagiaView in the browser.
2. Enter the Pelagia backend URL, usually `http://127.0.0.1:8000`.
3. Click `Connect`.
4. PelagiaView checks `/health` and `/system/status`.
5. After a successful connection, the dashboard opens and the endpoint is saved in browser local storage.

Disconnecting clears the active UI session, but does not stop backend jobs or workers.

## Connection Troubleshooting

If the browser reports `Failed to fetch` while the backend is running:

- Confirm the API responds outside the browser:

  ```bash
  curl http://127.0.0.1:8000/health
  ```

- Restart the Pelagia backend after pulling changes that add local-development CORS support.
- Make sure the browser endpoint is the API root, for example `http://127.0.0.1:8000`, not a nested route such as `/health`.
- If PelagiaView is running on a different host or non-local origin, the backend CORS allow-list will need to be expanded.

## Dashboard Structure

The app is organized around workflow and system pages:

- `Status`: shares `/jobs/status` snapshots with the other queue widgets, shows durable processing-submission planning after navigation or reload, and separately polls `/system/status`, `/workers`, and `/kvstore`; supports job pause, resume, retry, and worker shutdown where backend endpoints exist.
- `Ingestion`: browses server-side files through `GET /live/files`, recursively analyzes selected paths for interchange datasets, videos, and image-sequence folders, and queues the reviewed assets through one workflow. Each enabled asset requires an explicit light or dark background choice; the choice can be applied to all assets. Light backgrounds are inverted during preprocessing, while source pixels remain unchanged. Shared options cover area/line scan field generation, correction windows, and multi-frame tiling.
- `Telemetry`: analyzes server-side CSV sensor files through `POST /telemetry/analyze`, maps columns to the controlled unit vocabulary, previews values, and queues imports through `POST /runs/{run_id}/telemetry/import`.
- `Exports`: creates asynchronous, project-scoped reproducible bundles through `/exports`. Curation can pre-scope ROI products to its selected ROIs or supported review filters, and Telemetry can pre-scope an archive to its selected run.
- `Preprocessing`, `Segmentation`, and `ROI Refinement`: save selected assets, collection tags, state gates, and ranges through `POST /processing/submissions`. The server accepts the criteria immediately, plans the matching work asynchronously, and retains the request for System status monitoring. Retrying an ambiguous submission reuses its request ID, so it cannot create a duplicate request.
- `Explorer`: previews frames from video, image, image sequence, and interchange assets; runs live preprocessing/segmentation/refinement and displays overlays.
- `ROI Browser`: browses candidate or refined ROIs with filters, sorting, image overlays, masks, and frame context.
- `Event Log`: merges `/logs` and `/jobs/events`, with filters for source, level, event type, stage, status, run, job, and worker.

## API Approach

PelagiaView keeps all backend communication in `src/lib/api/client.ts`. Session state and the active API client live in `src/lib/stores/session.ts`.

The client uses short-lived caching for frequently refreshed reads so tab navigation stays responsive without hiding backend changes for long. Mutating calls clear the API client cache.

Queue displays subscribe to `src/lib/stores/queueStatus.ts`. Equivalent scopes
share one snapshot and poller: every 2.5 seconds for active work, 12 seconds when
idle, or 30 seconds in a hidden tab. Mutations request an immediate refresh.
The server supplies counts, percentages, rates, and ETA; components only format
them. Unknown estimates remain unavailable, and failed refreshes mark the last
snapshot stale. Switching project or authentication clears the old snapshot and
rejects outstanding responses from the previous session. Stage views show active
work; submitted-batch views include completed jobs in their explicit job scope.
Different stages and work units have separate progress displays. Stored frame
coverage, logs, and export artifact metadata retain their dedicated APIs.

Submission IDs use browser cryptographic randomness on both HTTP and HTTPS
origins. Request-preparation failures display an error and release the submit
button; retries preserve the original request ID and criteria.

Criteria-based processing submissions use the same session/project safeguards as
queue snapshots. System status polls the 50 most recent submissions every 2.5
seconds while any request is accepted or planning, then every 15 seconds while
visible (30 seconds in a hidden tab). A successful planning pass refreshes the
authoritative queue snapshot once jobs materialize.

Current backend endpoints used by the UI:

```text
GET  /health
GET  /system/status
GET  /system/use
GET  /system/config
GET  /jobs
GET  /jobs/status
GET  /jobs/events
POST /jobs/{job_id}/pause
POST /jobs/{job_id}/resume
POST /jobs/{job_id}/retry
GET  /workers
POST /workers/{worker_id}/shutdown
GET  /kvstore
GET  /live/files
GET  /live/segmentation
POST /live/preprocess
GET  /assets
GET  /assets/processing-state
GET  /assets/{asset_id}/frames
GET  /assets/{asset_id}/framedata/{frame_num}
GET  /assets/{asset_id}/detections
GET  /frames/processing-state
GET  /frames/{frame_id}/context
GET  /frame/original
GET  /frame/preprocessed
POST /frame/preprocess
POST /frame/preprocess/jobs
GET  /detections
GET  /detections/{detection_id}/framedata
GET  /detections/{detection_id}/mask
GET  /detections/{detection_id}/refined-roi
GET  /detections/{detection_id}/refined-mask
POST /ingestion/videos
GET  /segmentation/options
POST /segmentation/frames/{frame_id}
POST /segmentation/jobs
GET  /roi-refinement/options
POST /roi-refinement
POST /roi-refinement/jobs
GET  /logs
```

## Project Layout

```text
src/
  app.css                         global UI styling
  routes/+page.svelte             landing/dashboard switch
  lib/api/client.ts               Pelagia HTTP client and API cache
  lib/api/types.ts                shared API response types
  lib/stores/session.ts           endpoint/session state
  lib/components/EndpointLanding.svelte
  lib/components/Dashboard.svelte
  lib/components/StatusPage.svelte
  lib/components/IngestionPage.svelte
  lib/components/DatasetQueuePage.svelte
  lib/components/ExplorerPage.svelte
  lib/components/RoiBrowserPage.svelte
  lib/components/EventLogPage.svelte
```

## Development Notes

- Validate queue polling and session isolation with `npm run test:queue-status`;
  run `npm run check` and `npm run build` for Svelte and production validation.
- Keep new backend calls inside `src/lib/api/client.ts`.
- Keep page components focused on workflow state and rendering.
- Prefer adding typed response shapes in `src/lib/api/types.ts` as backend contracts stabilize.
- Preserve responsive layouts; the dashboard should remain usable on laptop, tablet, and narrow browser widths.
- PelagiaView should not directly inspect backend filesystems, spawn local processes, or bypass the Pelagia HTTP API.
