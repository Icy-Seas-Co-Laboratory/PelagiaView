# Getting started

[Documentation index](index.md) · [Repository overview](../README.md)

## Requirements

- Node.js 18 or newer
- npm
- A running Pelagia backend API

From the sibling Pelagia checkout, start a local backend stack:

```bash
cd ../Pelagia
./scripts/pelagia_dev_stack.sh start
```

Install and run PelagiaView from this repository:

```bash
npm ci
npm run dev -- --port 5173
```

Open `http://127.0.0.1:5173/`. For a LAN-accessible development server, use `npm run dev -- --host 0.0.0.0 --port 5173` and configure the backend CORS allow-list for the browser origin.

## Connect a session

Enter the Pelagia API root, usually `http://127.0.0.1:8000`, then provide a username and password and choose **Connect**. PelagiaView checks the API health and system status before showing the dashboard.

If the login returns several projects, select the project to open. If the account has no active project, the UI opens project setup. Create a project with a project key, optional name and description, a writable KV storage directory, and a KV store name; storage codec choices are constrained by the backend capabilities response.

## Prefixes and production builds

PelagiaView supports reverse-proxy deployment beneath a path prefix and a prefixed API URL:

```bash
PELAGIAVIEW_BASE_PATH=/pelagiaview \
PUBLIC_PELAGIA_API_URL=https://demo.example/pelagia-api \
npm run build

PELAGIAVIEW_BASE_PATH=/pelagiaview \
PUBLIC_PELAGIA_API_URL=https://demo.example/pelagia-api \
npm run preview -- --port 5173
```

Both values omit a trailing slash. Open `http://127.0.0.1:5173/pelagiaview/`. The production build uses SvelteKit's Node adapter. For the combined deployment, see [Pelagia's Docker guide](https://github.com/Icy-Seas-Co-Laboratory/Pelagia/blob/main/deploy/docker/README.md).

## Troubleshooting

Check the backend outside the browser:

```bash
curl http://127.0.0.1:8000/health
```

Use the API root rather than `/health` as the endpoint in PelagiaView. A `Failed to fetch` error usually means the backend is unreachable or its CORS configuration does not allow the UI origin.
