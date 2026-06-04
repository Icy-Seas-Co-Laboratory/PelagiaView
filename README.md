# PelagiaView

PelagiaView is a SvelteKit interface for working with a running Pelagia backend. It is intentionally focused on operational workflows: connecting to a backend session, monitoring queue and worker status, queueing raw video ingestion, previewing segmentation on stored frames, and reviewing job events.

## Requirements

- Node.js 18 or newer
- npm
- A running Pelagia backend API

The default UI session endpoint is:

```bash
http://127.0.0.1:8000
```

You may also enter `127.0.0.1:8000`; PelagiaView will normalize it to `http://127.0.0.1:8000`.

## Start the Backend

From the sibling `Pelagia` repository, start the API using the backend workflow you normally use. For local development, the existing project script is the easiest path when you want the backend stack:

```bash
cd ../Pelagia
./scripts/pelagia_dev_stack.sh
```

If you run the API manually, make sure it is reachable at the endpoint you plan to enter in PelagiaView. The UI currently expects the Pelagia HTTP API routes under the server root, such as `/health`, `/system/status`, `/jobs`, and `/assets`.

## Start PelagiaView

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev -- --port 5173
```

Open:

```bash
http://127.0.0.1:5173/
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

The app is organized around four tabs:

- `Status`: polls `/system/status`, `/jobs`, and `/workers`; supports job pause, resume, retry, and worker shutdown where backend endpoints exist.
- `Ingestion`: browses server-side files through `GET /live/files`, queues video paths through `POST /ingestion/videos`, and supports selected paths and manual batch entry.
- `Segmentation`: lists assets and frames, previews framedata through `/assets/{asset_id}/framedata/{frame_num}`, runs non-persisting live segmentation through `GET /live/segment`, can save a frame through `POST /segmentation/frames/{frame_id}`, and queues asset segmentation through `POST /segmentation/jobs`.
- `Event Log`: polls `/jobs/events` and renders recent job events as a readable timeline.

## API Approach

PelagiaView keeps all backend communication in `src/lib/api/client.ts`. Session state and the active API client live in `src/lib/stores/session.ts`.

The client uses short-lived caching for frequently refreshed reads so tab navigation stays responsive without hiding backend changes for long. Mutating calls clear the API client cache.

Current backend endpoints used by the UI:

```text
GET  /health
GET  /system/status
GET  /system/use
GET  /jobs
GET  /jobs/events
POST /jobs/{job_id}/pause
POST /jobs/{job_id}/resume
POST /jobs/{job_id}/retry
GET  /workers
POST /workers/{worker_id}/shutdown
GET  /live/files
GET  /live/segment
GET  /assets
GET  /assets/{asset_id}/frames
GET  /assets/{asset_id}/framedata/{frame_num}
GET  /assets/{asset_id}/detections
POST /ingestion/videos
POST /segmentation/frames/{frame_id}
POST /segmentation/jobs
```

## Planned Backend Endpoints

Some UI workflows are already shaped for backend endpoints that are not fully available yet:

- `POST /workers`: spawn a managed worker from the dashboard. The UI sends a capability payload, but current backend support may need to be added.
- `GET /live/logs`: stream job, worker, API, and processing logs without polling.

These should remain backend-owned APIs. PelagiaView should consume them through the API client rather than doing filesystem or process work directly.

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
  lib/components/SegmentationPage.svelte
  lib/components/EventLogPage.svelte
```

## Development Notes

- Keep new backend calls inside `src/lib/api/client.ts`.
- Keep page components focused on workflow state and rendering.
- Prefer adding typed response shapes in `src/lib/api/types.ts` as backend contracts stabilize.
- Preserve responsive layouts; the dashboard should remain usable on laptop, tablet, and narrow browser widths.
- PelagiaView should not directly inspect backend filesystems, spawn local processes, or bypass the Pelagia HTTP API.
