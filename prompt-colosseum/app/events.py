"""Socket.IO handlers: translate events into Room calls. The rules live in rooms.py."""
from flask import request
from flask_socketio import join_room, leave_room

from .rooms import GameError


def make_emit(socketio, registry):
    """The `emit_factory` a Registry needs: room-wide emits go to the Socket.IO room named by the
    code, private ones (`to` = a slot) go to that player's current socket."""
    def factory(code):
        def emit(event, payload, to=None):
            if to is None:
                socketio.emit(event, payload, to=code)
                return
            room = registry.get(code)
            sid = room.players[to].sid if room else None
            if sid:
                socketio.emit(event, payload, to=sid)
        return emit
    return factory


def register(socketio, registry):
    def tell(message):
        socketio.emit("error", {"message": message}, to=request.sid)

    def on(event):
        """Register fn(data) for an event; a GameError becomes an `error` event for the sender."""
        def decorate(fn):
            @socketio.on(event)
            def handler(data=None):
                try:
                    fn(data if isinstance(data, dict) else {})
                except GameError as e:
                    tell(str(e))
            return handler
        return decorate

    def me():
        found = registry.lookup(request.sid)
        if found is None:
            raise GameError("You are not in a room.")
        return found

    @socketio.on_error_default
    def broken(e):
        print("socket handler failed:", repr(e))
        tell("Something went wrong on the server.")

    @on("room:create")
    def create(d):
        if registry.lookup(request.sid):
            raise GameError("You are already in a room.")
        room, p = registry.create(d.get("name"), request.sid)
        registry.bind(request.sid, room.code, p.slot)
        join_room(room.code)
        room.hello(p.slot)

    @on("room:join")
    def join(d):
        if registry.lookup(request.sid):
            raise GameError("You are already in a room.")
        room = registry.get(str(d.get("code", "")).strip().upper())
        if room is None:
            raise GameError("No room with that code.")
        p = room.add_player(d.get("name"), request.sid)
        registry.bind(request.sid, room.code, p.slot)
        join_room(room.code)
        room.hello(p.slot)

    @on("room:rejoin")
    def rejoin(d):
        code = str(d.get("code", "")).strip().upper()
        room = registry.get(code)
        if room is None:
            raise GameError("That room is gone.")
        join_room(code)                         # first, so the state broadcast reaches this socket too
        try:
            slot = room.rejoin(d.get("playerId"), request.sid)
        except GameError:
            leave_room(code)
            raise
        registry.bind(request.sid, code, slot)

    @on("room:start")
    def start(d):
        room, slot = me()
        room.start(slot)

    @on("round:draft")
    def draft(d):
        room, slot = me()
        room.draft(slot, d.get("text"))

    @on("round:seal")
    def seal(d):
        room, slot = me()
        room.seal(slot, d.get("text"))

    @on("round:choose")
    def choose(d):
        room, slot = me()
        room.choose(slot, d.get("model"))

    @on("context:reset")
    def reset(d):
        room, slot = me()
        room.reset_context(slot, d.get("mode"))

    @on("round:next")
    def next_round(d):
        room, slot = me()
        room.next(slot)

    @on("match:yield")
    def yield_(d):
        room, slot = me()
        room.yield_(slot)

    @socketio.on("disconnect")
    def gone(reason=None):
        found = registry.lookup(request.sid)
        registry.unbind(request.sid)
        if found:
            found[0].disconnect(found[1], request.sid)
