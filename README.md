# PelagiaView

PelagiaView is a SvelteKit interface for working with a running Pelagia backend. It is intentionally focused on operational workflows: connecting to a backend session, monitoring queue and worker status, queueing processing work, exploring frames and ROIs, and reviewing logs/events.

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

- `Status`: polls `/system/status`, `/jobs`, `/jobs/summary`, `/workers`, and `/kvstore`; supports job pause, resume, retry, and worker shutdown where backend endpoints exist.
- `Ingestion`: browses server-side files through `GET /live/files` and queues video paths through `POST /ingestion/videos`.
- `Preprocessing`: filters frames through `/frames/processing-state` and queues preprocessing batches through `POST /frame/preprocess/jobs`.
- `Segmentation`: filters frames and queues candidate ROI generation through `POST /segmentation/jobs`.
- `ROI Refinement`: filters frames/ROIs and queues refinement work through `POST /roi-refinement/jobs`.
- `Explorer`: previews original/preprocessed frames, runs live preprocessing/segmentation/refinement, and displays overlays.
- `ROI Browser`: browses candidate or refined ROIs with filters, sorting, image overlays, masks, and frame context.
- `Event Log`: merges `/logs` and `/jobs/events`, with filters for source, level, event type, stage, status, run, job, and worker.

## API Approach

PelagiaView keeps all backend communication in `src/lib/api/client.ts`. Session state and the active API client live in `src/lib/stores/session.ts`.

The client uses short-lived caching for frequently refreshed reads so tab navigation stays responsive without hiding backend changes for long. Mutating calls clear the API client cache.

Current backend endpoints used by the UI:

```text
GET  /health
GET  /system/status
GET  /system/use
GET  /system/config
GET  /jobs
GET  /jobs/summary
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

- Keep new backend calls inside `src/lib/api/client.ts`.
- Keep page components focused on workflow state and rendering.
- Prefer adding typed response shapes in `src/lib/api/types.ts` as backend contracts stabilize.
- Preserve responsive layouts; the dashboard should remain usable on laptop, tablet, and narrow browser widths.
- PelagiaView should not directly inspect backend filesystems, spawn local processes, or bypass the Pelagia HTTP API.
