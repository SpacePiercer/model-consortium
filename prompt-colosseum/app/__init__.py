"""The Prompt Colosseum server: Flask for the page, Flask-SocketIO for the game."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def create_app(clock=None, judge=None):
    """`clock` and `judge` are for tests: a manual clock, and judges that need no network."""
    # imported here so that `from app import judges` stays light (the probe and the judge tests
    # need no Flask)
    from flask import Flask, render_template
    from flask_socketio import SocketIO

    from . import events, rooms

    app = Flask(__name__, static_folder=str(ROOT / "static"), template_folder=str(ROOT / "templates"))
    app.config["SECRET_KEY"] = os.getenv("FLASK_SECRET_KEY", "dev-only-change-me")
    # threading, not eventlet: no monkey-patching, and the judges' parallel calls just work
    app.socketio = SocketIO(app, async_mode="threading")
    app.registry = rooms.Registry(clock=clock, judge=judge)
    app.registry.emit_factory = events.make_emit(app.socketio, app.registry)
    events.register(app.socketio, app.registry)

    @app.get("/")
    @app.get("/solo")                           # open it in two tabs to play against yourself
    def index():
        from . import judges
        seats = [{"name": s.name, "model": s.judge.label} for s in judges.get_seats()]
        return render_template("game.html", seats=seats)

    @app.get("/healthz")
    def healthz():
        return "ok"                             # for the host's health check

    return app
