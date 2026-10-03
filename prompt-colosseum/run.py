"""
Run the game:   .venv/bin/python run.py            (then open http://localhost:5001)

One process only: rooms live in memory, so never run more than one worker. For a deployment:
    gunicorn -w 1 --threads 100 run:app
"""
import os

from app import create_app

app = create_app()

if __name__ == "__main__":
    # 5001, not Flask's usual 5000: macOS keeps 5000 for AirPlay
    app.socketio.run(app, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5001")),
                     allow_unsafe_werkzeug=True)
