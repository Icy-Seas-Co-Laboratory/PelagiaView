# Developer guide

[Documentation index](index.md) · [Repository overview](../README.md)

PelagiaView keeps backend communication in `src/lib/api/client.ts`, shared response/request shapes in `src/lib/api/types.ts`, and session/project state in `src/lib/stores/session.ts`. Components should call typed client methods rather than issuing ad hoc requests.

Queue displays subscribe to `src/lib/stores/queueStatus.ts`. Equivalent scopes share a snapshot and visibility-aware poller: active work refreshes every 2.5 seconds, idle work every 12 seconds, and hidden tabs every 30 seconds. Mutations request an immediate refresh. Unknown estimates stay unavailable, and stale snapshots are marked when refreshes fail.

Switching project or authentication clears the previous snapshot and rejects responses from the prior session. Criteria-based submissions retain their request ID across retries so an ambiguous retry cannot create a duplicate request.

The UI uses the Pelagia API for health, authentication, projects, assets, frames, detections, processing submissions, curation, Registry, exports, telemetry, jobs, workers, KV status, and logs. Keep endpoint details in the central client and update types when backend contracts change.

## Project layout

```text
src/routes/                 route and dashboard entry points
src/lib/api/client.ts       Pelagia HTTP client and cache
src/lib/api/types.ts        shared API response/request types
src/lib/stores/             session, queue, system-use, and display state
src/lib/components/         workflow pages and reusable UI components
src/lib/registry/            Registry workspace state and API helpers
src/lib/help/               contextual operator help
static/brand/               Pelagia brand assets
```

Run `npm run check`, `npm run build`, and the focused test scripts before release. Preserve responsive layouts, keyboard access, visible focus, and explicit loading/error/empty states.
