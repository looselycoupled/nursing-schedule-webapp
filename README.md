# Nursing Schedule

A small Flask web app that helps parents of newborns visualize when the next
few feedings should happen. The user scrolls a vertical day timeline to mark
the last feeding, picks a 2h / 2½h / 3h interval, and sees the next three
feeding times at a glance.

Designed mobile-first, dark by default, and intentionally kept simple — no
database, no build step, no frameworks.

## Run with Docker Compose

```bash
docker compose up -d
```

Pulls the prebuilt image from `ghcr.io/looselycoupled/nursing-schedule-webapp`
(amd64 and arm64, rebuilt on every push to `main`). To build from source
instead, swap the compose file's `image:` line for `build: .` and run
`docker compose up --build`.

Then open <http://localhost:8000>.

Stop with `Ctrl+C` or `docker compose down`.

To run in the background:

```bash
docker compose up -d
docker compose logs -f
```

## Run locally (no Docker)

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

## Project layout

```
.
├── app.py                 # Flask entry point (also exposes a JSON API)
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── templates/
│   └── index.html
└── static/
    ├── css/style.css
    └── js/app.js
```

## HTTP API

The front-end computes everything client-side, but the server also exposes a
JSON endpoint for future clients (CLI, widget, companion app, etc.).

**`POST /api/next-feedings`**

```json
{
  "last_feeding": "2026-04-19T14:30:00-04:00",
  "interval_minutes": 150,
  "count": 3
}
```

Returns:

```json
{
  "last_feeding": "2026-04-19T14:30:00-04:00",
  "interval_minutes": 150,
  "next_feedings": [
    "2026-04-19T17:00:00-04:00",
    "2026-04-19T19:30:00-04:00",
    "2026-04-19T22:00:00-04:00"
  ]
}
```

`interval_minutes` must be one of `120`, `150`, or `180`.
If `last_feeding` is omitted, the current server time (UTC) is used.

**`GET /healthz`** returns `{"status": "ok"}` — used by the Docker health check.

## iOS timer button (optional)

On iPhone / iPad, each future feeding in the summary list gets a ⏲ button. Tap
it and iOS will start a native countdown timer for that many minutes via the
Shortcuts app — no database, no notifications, no background service needed.

This requires a one-time setup on the phone:

1. Open the **Shortcuts** app.
2. Create a new shortcut named exactly `Start Feeding Timer`.
3. Add the action **Get Numbers from Input** (it receives Shortcut Input by default).
4. Add the action **Start Timer**; set the *Duration* to the **Numbers**
   variable from step 3 and the unit to **Minutes**.
5. Save.

That's it. The web app builds a `shortcuts://run-shortcut?name=Start%20Feeding%20Timer&input=text&text=<minutes>`
URL per feeding and taps launch the shortcut. If you prefer a different name,
edit `SHORTCUT_NAME` in `static/js/app.js`.

The button and setup disclosure are only shown when the browser detects iOS
or iPadOS.

## Adding a database later

When you outgrow the stateless version (e.g. to save history across devices),
add a `db` service to `docker-compose.yml` and wire it up in `app.py`. The
current code has no persistence layer to rip out, so the migration is clean.
