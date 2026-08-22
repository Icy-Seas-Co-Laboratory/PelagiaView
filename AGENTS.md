# AGENTS.md

## Purpose

PelagiaView is the SvelteKit interface for a running Pelagia backend. It supports
operational image-processing workflows, curation, Registry, and system status.
Keep the UI responsive, scientifically clear, and faithful to backend state;
never imply that a queued, partial, or failed operation completed successfully.

## Work efficiently

- Start with `rg` or `rg --files` in the relevant route, component, API, store,
  or utility; do not read the whole repository.
- Search `README.md` for the relevant heading before opening a small range. Read
  sibling `../Pelagia` files only when the task depends on a backend contract.
- Inspect a component together with its imported API methods, types, stores, and
  closest utilities. Avoid loading unrelated large Svelte components.
- Do not inspect `node_modules/`, `.svelte-kit/`, `build/`, browser profiles,
  caches, or generated files unless the task specifically requires them.
- Preserve unrelated working-tree changes. Do not reformat or reorganize files
  outside the requested scope.

## Hybrid model routing

Use the least expensive model that can reliably complete the task. Keep one
model responsible for final integration; delegate only bounded, independent
work with explicit inputs and expected outputs. Avoid sending the same broad
repository context to multiple models.

- **Luna (`gpt-5.6-luna`)**: use for repository searches, component inventories,
  mechanical TypeScript/CSS edits, copy cleanup, simple typed helpers, repetitive
  accessibility fixes, and running known checks. Default to low or medium
  reasoning.
- **Terra (`gpt-5.6-terra`)**: default implementation model. Use for normal UI
  features and bug fixes, Svelte state and lifecycle work, API-client additions,
  responsive layouts, focused refactors, and integrating Luna results. Default
  to medium reasoning; use high when several workflows or stores interact.
- **Sol (`gpt-5.6-sol`)**: escalate ambiguous architecture, complex interactive
  state, authentication or project-isolation boundaries, destructive actions,
  cache-consistency risks, accessibility-sensitive redesigns, backend contract
  changes spanning both repositories, or difficult root-cause analysis. Use high
  or greater reasoning only when the risk or ambiguity warrants it.

For substantial work, route narrow discovery to Luna, let Terra own planning and
implementation, and ask Sol only the uncertain or high-risk question. Pass a
compact handoff containing exact files, constraints, evidence, and the decision
needed—not raw transcripts or a repository dump. Return mechanical follow-up to
Luna and normal integration to Terra. Model routing never expands user scope or
bypasses approval and destructive-action safeguards.

## Repository map

- `src/routes/`: SvelteKit pages, dynamic workflow routes, and server endpoints.
- `src/lib/components/`: workflow pages and reusable interface components.
- `src/lib/api/client.ts`: central Pelagia HTTP client, authentication, and cache.
- `src/lib/api/types.ts`: shared backend response and request types.
- `src/lib/stores/`: session, system-use, display, and processing-preset state.
- `src/lib/registry/`: Registry workspace state, API helpers, selection, and layout.
- `src/lib/processing/`: processing-setting models and translations.
- `src/lib/utils/`: focused presentation, image, preferences, and download helpers.
- `src/lib/help/`: user-facing contextual help in Markdown.
- `src/lib/presets/`: bundled processing presets; preserve TOML compatibility.
- `src/app.css` and `src/workbench.css`: global application/workbench styling.
- `static/brand/`: Pelagia brand assets.
- `../Pelagia/`: sibling backend and source of HTTP/data contracts. Do not edit it
  unless the task explicitly includes backend work.

## Architectural boundaries

- Keep backend calls centralized in `src/lib/api/client.ts`, with shared contract
  shapes in `src/lib/api/types.ts`. Components should not issue ad hoc fetches.
- Keep session and active-project behavior in the established stores. Every
  project-scoped request and cached result must respect session/project changes.
- Mutations must surface pending, success, empty, and failure states and must
  invalidate or refresh affected cached reads.
- PelagiaView never reads backend filesystems, launches local processes, or
  bypasses the Pelagia HTTP API.
- The Registry workspace uses the same Pelagia session/project and `/registry/*`
  API. PelagiaView is its canonical networked UI; ports to standalone Registry
  should be deliberate rather than allowed to drift independently.
- Preserve configured base paths and API prefixes. Do not assume deployment at
  `/` or a backend fixed at `127.0.0.1`.
- Keep scientific labels, units, masks, classifications, processing state, and
  provenance explicit. Do not silently coerce missing or unknown values.

## Svelte and UI conventions

- Follow the Svelte 5 and TypeScript patterns in adjacent files; do not mix in a
  new state-management or component framework without a clear requirement.
- Prefer small typed utilities and derived state over duplicated transformations
  across components. Clean up timers, subscriptions, object URLs, and listeners.
- Preserve keyboard access, visible focus, semantic controls, useful labels, and
  adequate contrast. Dialogs must support predictable focus and dismissal.
- Preserve laptop, tablet, and narrow-screen layouts. Avoid fixed sizing unless
  the workspace already provides resizing or overflow behavior.
- Use existing design tokens and visual patterns before adding new global CSS.
  Keep dense operational views legible rather than decorative.
- User-facing help must match implemented behavior and current backend contracts.

## Validation

Install dependencies only when needed, using the committed lockfile:

```bash
npm ci
npm run check
npm run build
```

Run `npm run check` after TypeScript or Svelte changes and `npm run build` for
routes, server code, configuration, base-path behavior, or release-facing work.
There is currently no automated test script; do not claim tests passed unless a
test runner is added and run. For interactive changes, manually verify the
affected workflow at relevant viewport sizes and record what was or was not
checked. Backend-dependent validation requires a compatible Pelagia API.

## Change expectations

- Match established naming, loading/error-state, request, and styling patterns
  in adjacent code before adding an abstraction.
- Update API types, client methods, UI behavior, and relevant README/help text
  together when a contract or user-visible workflow changes.
- Coordinate cross-repository API changes explicitly and preserve compatibility
  where practical; frontend assumptions alone do not change the backend contract.
- Never commit tokens, credentials, local endpoints, machine-specific paths,
  browser state, or generated build output.
- Comments should explain workflow intent, browser quirks, or non-obvious state
  transitions rather than restating markup or code.
