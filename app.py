"""Nursing schedule helper — a tiny Flask app.

The front-end does all of the interactive timeline scrolling and next-feed
math client-side so the experience stays snappy on a phone. The server
exposes a JSON endpoint as well in case the same schedule is ever needed
from another client (e.g. a future companion app or widget).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

# Presets the UI offers. Keep server + client in sync.
ALLOWED_INTERVAL_MINUTES: set[int] = {120, 150, 180}
DEFAULT_INTERVAL_MINUTES: int = 150
DEFAULT_COUNT: int = 2


@app.get("/")
def index():
    return render_template(
        "index.html",
        intervals=sorted(ALLOWED_INTERVAL_MINUTES),
        default_interval=DEFAULT_INTERVAL_MINUTES,
        default_count=DEFAULT_COUNT,
    )


@app.post("/api/next-feedings")
def next_feedings():
    """Return the next N feeding times given a last feeding timestamp."""
    payload = request.get_json(silent=True) or {}

    interval_minutes = int(payload.get("interval_minutes", DEFAULT_INTERVAL_MINUTES))
    if interval_minutes not in ALLOWED_INTERVAL_MINUTES:
        return (
            jsonify(error=f"interval_minutes must be one of {sorted(ALLOWED_INTERVAL_MINUTES)}"),
            400,
        )

    count = int(payload.get("count", DEFAULT_COUNT))
    if not 1 <= count <= 24:
        return jsonify(error="count must be between 1 and 24"), 400

    last_iso = payload.get("last_feeding")
    if last_iso:
        try:
            # Accept trailing Z (UTC) too.
            last = datetime.fromisoformat(last_iso.replace("Z", "+00:00"))
        except ValueError:
            return jsonify(error="last_feeding must be ISO 8601"), 400
    else:
        last = datetime.now(timezone.utc)

    upcoming = [
        last + timedelta(minutes=interval_minutes * (i + 1)) for i in range(count)
    ]
    return jsonify(
        last_feeding=last.isoformat(),
        interval_minutes=interval_minutes,
        next_feedings=[t.isoformat() for t in upcoming],
    )


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


if __name__ == "__main__":
    # Local dev entry point — Docker uses gunicorn (see Dockerfile CMD).
    app.run(host="0.0.0.0", port=8000, debug=True)
