# Provides WebSocket game and matchmaking handlers
import logging
from typing import Dict, Set
from fastapi import WebSocket
import asyncio
import json
import time
from typing import Optional
import chess
import chess.engine
from bson import ObjectId
from fastapi import WebSocket, WebSocketDisconnect
from core import decode_access_token
from core import get_db
from engines import analyze_position, evaluate_single_move, _build_explanation
from engines import classify_move
from engines import EngineType, get_pool
from fastapi import WebSocket, Query, WebSocketDisconnect
from core import GameDoc
from intelligence import enqueue, dequeue, check_for_match, set_matched

logger = logging.getLogger(__name__)

# Manages WebSocket connections per game
class ConnectionManager:
    # Initializes connection manager resources
    def __init__(self):
        self._rooms: Dict[str, Set[WebSocket]] = {}
        self._player_ws: Dict[str, Dict[str, WebSocket]] = {}  # game_id -> {user_id: ws}

    # Accepts and registers client connection
    async def connect(self, game_id: str, websocket: WebSocket, user_id: str = None):
        await websocket.accept()
        if game_id not in self._rooms:
            self._rooms[game_id] = set()
        self._rooms[game_id].add(websocket)
        if user_id:
            if game_id not in self._player_ws:
                self._player_ws[game_id] = {}
            self._player_ws[game_id][user_id] = websocket
        logger.info(f"[ws] Client connected to game {game_id}. Room size: {len(self._rooms[game_id])}")


    # Removes client from game room
    def disconnect(self, game_id: str, websocket: WebSocket):
        if game_id in self._rooms:
            self._rooms[game_id].discard(websocket)
            if not self._rooms[game_id]:
                del self._rooms[game_id]
        if game_id in self._player_ws:
            to_remove = [uid for uid, ws in self._player_ws[game_id].items() if ws is websocket]
            for uid in to_remove:
                del self._player_ws[game_id][uid]
            if not self._player_ws[game_id]:
                del self._player_ws[game_id]
        logger.info(f"[ws] Client disconnected from game {game_id}.")


    # Broadcasts message to room clients
    async def broadcast(self, game_id: str, message: dict):
        if game_id not in self._rooms:
            return
        disconnected = set()
        for ws in list(self._rooms[game_id]):
            try:
                await ws.send_json(message)
            except Exception:
                disconnected.add(ws)
        for ws in disconnected:
            self._rooms[game_id].discard(ws)


    # Sends message to specific client
    async def send_to(self, websocket: WebSocket, message: dict):
        try:
            await websocket.send_json(message)
        except Exception as e:
            logger.warning(f"[ws] Failed to send to client: {e}")

    # Gets websocket for a specific user in a room
    def get_player_ws(self, game_id: str, user_id: str) -> Optional[WebSocket]:
        return self._player_ws.get(game_id, {}).get(user_id)

    # Broadcasts to all clients EXCEPT the sender
    async def broadcast_except(self, game_id: str, exclude_ws: WebSocket, message: dict):
        if game_id not in self._rooms:
            return
        disconnected = set()
        for ws in list(self._rooms[game_id]):
            if ws is exclude_ws:
                continue
            try:
                await ws.send_json(message)
            except Exception:
                disconnected.add(ws)
        for ws in disconnected:
            self._rooms[game_id].discard(ws)


manager = ConnectionManager()


logger = logging.getLogger(__name__)


# Handles live game socket interactions
_game_states: dict[str, dict] = {}


_clock_tasks: dict[str, asyncio.Task] = {}


# Holds mutable live game state
class GameState:
    # Initializes connection manager resources
    def __init__(self, game_doc: dict):
        self.game_id = str(game_doc["_id"])
        self.mode = game_doc["mode"]
        self.white_id = game_doc.get("white_id")
        self.black_id = game_doc.get("black_id")
        self.bot_engine = game_doc.get("bot_engine")
        self.bot_level = game_doc.get("bot_level", 5)
        self.bot_depth = game_doc.get("bot_depth")
        self.maia_elo = game_doc.get("maia_elo")
        self.player_color = game_doc.get("player_color", "white")
        self.time_control = game_doc.get("time_control_seconds", 600) * 1000
        self.increment = game_doc.get("increment_seconds", 0) * 1000

        self.board = chess.Board()
        self.moves: list[dict] = []
        self.redo_stack: list[dict] = []
        self.clocks = {
            "white": self.time_control,
            "black": self.time_control,
        }
        self.last_move_time: float = time.time()


        self.clock_running: bool = False
        self.result: Optional[str] = None
        self.training_mode = game_doc.get("training_mode", False)
        self.last_eval_cp: int = 0
        self.ready_players: set = set()  # tracks which user_ids have sent 'ready'


# Returns side to move color
def _side_to_move(state: GameState) -> str:
    return "white" if state.board.turn == chess.WHITE else "black"


# Returns authoritative clocks with deduction
def live_clocks(state: GameState, now: Optional[float] = None) -> dict:
    clocks = dict(state.clocks)
    if state.time_control <= 0 or state.result or not state.clock_running:
        return clocks
    if not state.board.is_game_over():
        side = _side_to_move(state)
        elapsed_ms = int(((now if now is not None else time.time()) - state.last_move_time) * 1000)
        if elapsed_ms > 0:
            clocks[side] = max(0, clocks[side] - elapsed_ms)
    return clocks


# Broadcasts clocks and flags timeouts
async def _clock_ticker(game_id: str):
    try:
        while True:
            await asyncio.sleep(1.0)
            state = _game_states.get(game_id)
            if state is None or state.result:
                break
            if state.time_control <= 0 or not state.clock_running:
                continue
            if state.board.is_game_over():
                continue
            now = time.time()
            clocks = live_clocks(state, now)
            await manager.broadcast(game_id, {"type": "clock", "payload": clocks})
            side = _side_to_move(state)
            if clocks[side] <= 0:
                winner = "black" if side == "white" else "white"
                logger.info(f"[clock] {game_id}: {side} flagged (server ticker)")
                await _end_game(game_id, state, winner)
                break
    except asyncio.CancelledError:
        pass
    finally:
        _clock_tasks.pop(game_id, None)


# Ensures clock ticker task runs
def _ensure_clock_task(game_id: str, state: GameState):
    if state.time_control <= 0 or state.result:
        return
    existing = _clock_tasks.get(game_id)
    if existing is not None and not existing.done():
        return
    _clock_tasks[game_id] = asyncio.create_task(_clock_ticker(game_id))


# Returns cached game state
def _get_state(game_id: str) -> Optional[GameState]:
    return _game_states.get(game_id)


# Caches game state by identifier
def _set_state(game_id: str, state: GameState):
    _game_states[game_id] = state


# Returns bot engine move as UCI
async def _get_engine_move(
    board: chess.Board,
    bot_engine: str,
    bot_level: int,
    bot_depth: Optional[int] = None,
    maia_elo: Optional[int] = None,
) -> str:
    bot_level = bot_level or 5

    if bot_engine == "maia3":
        from engines import get_maia_move
        try:
            elo = maia_elo if maia_elo else 1100 + (bot_level - 1) * 100
            return await get_maia_move(board.fen(), elo=int(elo))
        except Exception as e:
            logger.warning(f"[bot] Maia-3 unavailable ({e}); falling back to Stockfish")
            bot_engine = "stockfish"

    if bot_engine == "stockfish":
        sf_pool = get_pool(EngineType.STOCKFISH)
        engine = await sf_pool.acquire()
        try:
            depth = int(bot_depth) if bot_depth else max(1, bot_level * 2)
            depth = max(1, min(20, depth))
            result = await engine.play(
                board, chess.engine.Limit(depth=depth)
            )
            return result.move.uci()
        finally:
            await sf_pool.release(engine)


    sf_pool = get_pool(EngineType.STOCKFISH)
    engine = await sf_pool.acquire()
    try:
        result = await engine.play(board, chess.engine.Limit(depth=5))
        return result.move.uci()
    finally:
        await sf_pool.release(engine)


# Handles game WebSocket lifecycle
async def handle_game_socket(
    game_id: str,
    websocket: WebSocket,
    token: str,
):
    user_id = decode_access_token(token)
    if not user_id:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    db = get_db()
    game_doc = await db.games.find_one({"_id": ObjectId(game_id)})
    if not game_doc:
        await websocket.close(code=4004, reason="Game not found")
        return


    allowed_ids = {str(game_doc.get("white_id")), str(game_doc.get("black_id"))}
    allowed_ids.discard("None")
    if allowed_ids and user_id not in allowed_ids:
        await websocket.close(code=4003, reason="Forbidden")
        return


    await manager.connect(game_id, websocket, user_id)


    if game_id not in _game_states:
        state = GameState(game_doc)
        _set_state(game_id, state)
    else:
        state = _get_state(game_id)


    await manager.send_to(websocket, {
        "type": "game_state",
        "payload": {
            "fen": state.board.fen(),
            "clocks": live_clocks(state),
            "moves": state.moves,
            "result": state.result,
            "can_takeback": bool(state.mode == "bot" and len(state.moves) > 0 and not state.result),
            "can_redo": bool(state.mode == "bot" and len(state.redo_stack) > 0 and not state.result),
            "bot_engine": state.bot_engine,
            "bot_depth": state.bot_depth,
            "maia_elo": state.maia_elo,
        },
    })


    _ensure_clock_task(game_id, state)

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            msg_type = msg.get("type")

            if msg_type == "move":
                await _handle_move(game_id, state, msg["payload"], user_id, websocket)

            elif msg_type == "takeback":
                await _handle_takeback(game_id, state, user_id, websocket)

            elif msg_type == "redo":
                await _handle_redo(game_id, state, user_id, websocket)

            elif msg_type == "bot_first_move":
                await _handle_bot_first_move(game_id, state, user_id, websocket)

            elif msg_type == "resign":
                loser = (msg.get("payload") or {}).get("color")
                if loser in ("white", "black"):
                    result = "black" if loser == "white" else "white"
                else:
                    result = "black" if state.board.turn == chess.WHITE else "white"
                await _end_game(game_id, state, result)

            elif msg_type == "draw_offer":
                if state.mode == "bot":
                    # Bot auto-decides: accept if it's losing, decline otherwise
                    import chess.engine as ce
                    try:
                        from engines import get_pool, EngineType
                        sf_pool = get_pool(EngineType.STOCKFISH)
                        engine = await sf_pool.acquire()
                        try:
                            info = await engine.analyse(state.board, ce.Limit(depth=10))
                            score = info.get("score")
                            cp = score.relative.score(mate_score=10000) if score else 0
                        finally:
                            await sf_pool.release(engine)
                        # Bot is playing as the side NOT equal to user's player_color
                        # cp is relative to side to move
                        bot_color = "black" if state.player_color == "white" else "white"
                        # Positive cp means side-to-move is winning
                        # Bot accepts if it's losing (cp favorable to user)
                        if bot_color == "white":
                            bot_is_losing = cp > 100  # user (black) is ahead
                        else:
                            bot_is_losing = cp < -100  # user (white) is ahead
                        if bot_is_losing:
                            await _end_game(game_id, state, "draw")
                        else:
                            await manager.send_to(websocket, {
                                "type": "draw_declined",
                                "payload": {"msg": "The coach declined the draw offer."},
                            })
                    except Exception as e:
                        logger.warning(f"[bot] Draw offer evaluation failed: {e}; auto-declining")
                        await manager.send_to(websocket, {
                            "type": "draw_declined",
                            "payload": {"msg": "The coach declined the draw offer."},
                        })
                else:
                    # Send draw offer only to the opponent, not the sender
                    await manager.broadcast_except(game_id, websocket, {
                        "type": "draw_offer",
                        "payload": {"from": user_id},
                    })
                    # Notify the sender that their offer was sent
                    await manager.send_to(websocket, {
                        "type": "draw_offer_sent",
                        "payload": {},
                    })

            elif msg_type == "draw_accept":
                await _end_game(game_id, state, "draw")

            elif msg_type == "timeout":
                losing_color = msg.get("payload", {}).get("color")
                if losing_color in ("white", "black") and not state.result:
                    authoritative = live_clocks(state)
                    if authoritative.get(losing_color, 1) <= 0 or state.time_control <= 0:
                        winner = "black" if losing_color == "white" else "white"
                        await _end_game(game_id, state, winner)
                    else:
                        await manager.send_to(websocket, {
                            "type": "clock",
                            "payload": authoritative,
                        })

            elif msg_type == "ping":
                await manager.send_to(websocket, {"type": "pong", "payload": {}})

            elif msg_type == "ready":
                # For bot/pass_and_play games, start immediately
                if state.mode in ("bot", "pass_and_play"):
                    if len(state.moves) == 0:
                        state.last_move_time = time.time()
                    state.clock_running = True
                    _ensure_clock_task(game_id, state)
                else:
                    # Multiplayer: wait for both players to be ready
                    state.ready_players.add(user_id)
                    both_ids = {state.white_id, state.black_id} - {None}
                    if both_ids and state.ready_players.issuperset(both_ids):
                        # Both players ready — start the clock
                        if len(state.moves) == 0:
                            state.last_move_time = time.time()
                        state.clock_running = True
                        _ensure_clock_task(game_id, state)
                        await manager.broadcast(game_id, {"type": "both_ready", "payload": {}})
                    else:
                        # Notify this player they are queued
                        await manager.send_to(websocket, {"type": "waiting_for_opponent", "payload": {}})

    except WebSocketDisconnect:
        manager.disconnect(game_id, websocket)
        logger.info(f"[ws] {user_id} disconnected from game {game_id}")


# Validates applies and broadcasts player move
async def _handle_move(
    game_id: str,
    state: GameState,
    payload: dict,
    user_id: str,
    websocket: WebSocket,
):
    uci_str = payload.get("uci", "")
    now = time.time()


    is_white_turn = state.board.turn == chess.WHITE
    if (is_white_turn and user_id != state.white_id and state.mode != "pass_and_play"):
        await manager.send_to(websocket, {"type": "error", "payload": {"msg": "Not your turn"}})
        return


    try:
        move = chess.Move.from_uci(uci_str)
        if move not in state.board.legal_moves:
            await manager.send_to(websocket, {"type": "error", "payload": {"msg": "Illegal move"}})
            return
    except ValueError:
        await manager.send_to(websocket, {"type": "error", "payload": {"msg": "Invalid move format"}})
        return


    side = "white" if is_white_turn else "black"
    if state.time_control > 0 and state.clock_running:
        elapsed_ms = int((now - state.last_move_time) * 1000)
    else:
        elapsed_ms = 0
    if state.time_control > 0:
        state.clocks[side] = max(0, state.clocks[side] - elapsed_ms + state.increment)
        state.last_move_time = now
        state.clock_running = True
        _ensure_clock_task(game_id, state)


    san = state.board.san(move)
    state.board.push(move)

    move_record = {
        "ply": len(state.moves) + 1,
        "san": san,
        "uci": uci_str,
        "from_sq": uci_str[:2],
        "to_sq": uci_str[2:4],
        "time_spent_ms": elapsed_ms,
        "elapsed_ms": elapsed_ms,
        "clock_remaining_ms": state.clocks[side],
        "fen": state.board.fen(),
    }

    state.moves.append(move_record)

    state.redo_stack = []


    if state.training_mode and len(state.moves) > 2:
        asyncio.create_task(_send_human_feedback(game_id, state, uci_str, is_white_turn, state.board.is_capture(move)))


    await manager.broadcast(game_id, {
        "type": "move",
        "payload": move_record,
    })
    await manager.broadcast(game_id, {
        "type": "clock",
        "payload": live_clocks(state),
    })


    if state.board.is_game_over():
        result = _get_result(state.board)
        await _end_game(game_id, state, result)
        return


    if state.time_control > 0 and state.clocks[side] <= 0:
        result = "black" if side == "white" else "white"
        await _end_game(game_id, state, result)
        return


    if state.mode == "bot" and not state.board.is_game_over():
        asyncio.create_task(_bot_reply(game_id, state))


# Undoes recent plies into redo stack
async def _handle_takeback(game_id: str, state: GameState, user_id: str, websocket: WebSocket):
    if state.mode != "bot" or state.result:
        await manager.send_to(websocket, {"type": "error", "payload": {"msg": "Takeback is only available in bot games"}})
        return
    if len(state.moves) == 0:
        await manager.send_to(websocket, {"type": "error", "payload": {"msg": "No moves to take back"}})
        return


    pops = min(2, len(state.moves)) if len(state.moves) >= 2 else 1

    popped: list[dict] = []
    for _ in range(pops):
        try:
            state.board.pop()
        except Exception:
            break
        popped.append(state.moves.pop())

    state.redo_stack.extend(reversed(popped))
    await manager.broadcast(game_id, {
        "type": "takeback",
        "payload": {
            "fen": state.board.fen(),
            "moves": state.moves,
            "can_takeback": len(state.moves) > 0,
            "can_redo": len(state.redo_stack) > 0,
        },
    })


# Replays taken-back plies
async def _handle_redo(game_id: str, state: GameState, user_id: str, websocket: WebSocket):
    if state.mode != "bot" or state.result:
        await manager.send_to(websocket, {"type": "error", "payload": {"msg": "Redo is only available in bot games"}})
        return
    if len(state.redo_stack) == 0:
        await manager.send_to(websocket, {"type": "error", "payload": {"msg": "Nothing to redo"}})
        return

    replays = min(2, len(state.redo_stack))
    for _ in range(replays):
        rec = state.redo_stack.pop(0)
        try:
            mv = chess.Move.from_uci(rec["uci"])
            if mv not in state.board.legal_moves:
                continue
            state.board.push(mv)
            rec = {**rec, "ply": len(state.moves) + 1, "fen": state.board.fen()}
            state.moves.append(rec)
        except Exception:
            continue
    await manager.broadcast(game_id, {
        "type": "redo",
        "payload": {
            "fen": state.board.fen(),
            "moves": state.moves,
            "can_takeback": len(state.moves) > 0,
            "can_redo": len(state.redo_stack) > 0,
        },
    })


# Triggers bot opening move as White
async def _handle_bot_first_move(game_id: str, state: GameState, user_id: str, websocket: WebSocket):
    if state.mode != "bot" or state.result:
        return
    if len(state.moves) > 0 or len(state.board.move_stack) > 0:
        await manager.send_to(websocket, {"type": "error", "payload": {"msg": "Bot can only start an empty game"}})
        return

    if state.black_id != user_id and state.player_color != "black":
        await manager.send_to(websocket, {"type": "error", "payload": {"msg": "Bot starts only when it has White"}})
        return
    asyncio.create_task(_bot_reply(game_id, state))


# Generates and broadcasts bot response
async def _bot_reply(game_id: str, state: GameState):
    if getattr(state, "training_mode", False):
        ply_before = len(state.moves)
        await asyncio.sleep(5.0)

        if ply_before != len(state.moves) or state.result:
            return

    try:
        bot_uci = await asyncio.wait_for(
            _get_engine_move(
                state.board,
                bot_engine=state.bot_engine,
                bot_level=state.bot_level,
                bot_depth=getattr(state, "bot_depth", None),
                maia_elo=getattr(state, "maia_elo", None),
            ),
            timeout=120,
        )
    except Exception:
        logger.exception(f"[bot] Engine move failed for game {game_id} ({state.bot_engine})")
        await manager.broadcast(game_id, {
            "type": "error",
            "payload": {"msg": "Coach engine failed to reply. Please make another move or start a new game."},
        })
        return

    try:
        move = chess.Move.from_uci(bot_uci)
    except Exception:
        logger.exception(f"[bot] Engine returned unparsable move {bot_uci!r} for game {game_id}.")
        await manager.broadcast(game_id, {
            "type": "error",
            "payload": {"msg": "Coach engine returned a bad move. Please make another move or start a new game."},
        })
        return
    if move not in state.board.legal_moves:
        logger.error(f"[bot] Engine returned illegal move {bot_uci} for game {game_id}; skipping reply.")
        await manager.broadcast(game_id, {
            "type": "error",
            "payload": {"msg": "Coach engine returned an illegal move. Please make another move or start a new game."},
        })
        return

    san = state.board.san(move)
    ply = len(state.moves) + 1
    is_white = state.board.turn == chess.WHITE
    state.board.push(move)

    move_record = {
        "ply": ply,
        "san": san,
        "uci": bot_uci,
        "from_sq": bot_uci[:2],
        "to_sq": bot_uci[2:4],
        "time_spent_ms": 0,
        "elapsed_ms": 800,
        "clock_remaining_ms": state.clocks["white" if is_white else "black"],
        "fen": state.board.fen(),
        "is_bot": True,
    }

    if state.training_mode:
        board_before = state.board.copy()
        board_before.pop()
        move_record["explanation"] = _build_explanation(board_before, move, None)

    state.moves.append(move_record)


    state.last_move_time = time.time()
    state.clock_running = True

    await manager.broadcast(game_id, {
        "type": "move",
        "payload": move_record,
    })
    await manager.broadcast(game_id, {
        "type": "clock",
        "payload": live_clocks(state),
    })


    if state.training_mode:
        asyncio.create_task(_send_training_analysis(game_id, state, move_record["fen"]))

    if state.board.is_game_over():
        result = _get_result(state.board)
        await _end_game(game_id, state, result)


# Broadcasts multi-engine training analysis
async def _send_training_analysis(game_id: str, state: GameState, fen_after_bot_move: str):
    try:
        analysis = await analyze_position(fen_after_bot_move, multipv=5)


        if analysis.stockfish_candidates:
            state.last_eval_cp = analysis.stockfish_candidates[0].eval_cp

        await manager.broadcast(game_id, {
            "type": "training_analysis",
            "payload": {
                "fen": analysis.fen,
                "candidates": [c.model_dump() for c in analysis.stockfish_candidates],
            },
        })
    except Exception as e:
        logger.error(f"[training] Analysis failed for game {game_id}: {e}")


# Evaluates and broadcasts human move feedback
async def _send_human_feedback(game_id: str, state: GameState, uci_str: str, is_white_turn: bool, is_capture: bool):
    try:
        board_before = state.board.copy()
        board_before.pop()
        eval_after = await evaluate_single_move(board_before.fen(), uci_str)

        classification = classify_move(
            eval_before_cp=state.last_eval_cp,
            eval_after_cp=eval_after,
            is_white_to_move=is_white_turn,
            is_capture=is_capture,
            best_move_cp=None,
        )

        for m in reversed(state.moves):
            if not m.get("is_bot") and m.get("uci") == uci_str:
                m["classification"] = classification
                m["eval_before"] = state.last_eval_cp
                m["eval_after"] = eval_after
                break

        await manager.broadcast(game_id, {
            "type": "human_move_feedback",
            "payload": {
                "classification": classification,
                "eval_before": state.last_eval_cp,
                "eval_after": eval_after,
            }
        })
    except Exception as e:
        logger.error(f"[training] Human feedback failed: {e}")


# Finalizes game and persists result
async def _end_game(game_id: str, state: GameState, result: str):
    if state.result:
        return
    state.result = result
    state.clock_running = False


    task = _clock_tasks.pop(game_id, None)
    if task is not None and not task.done():
        task.cancel()

    db = get_db()
    try:
        slim = []
        for m in (state.moves or []):
            slim.append({
                "ply": m.get("ply"), "san": m.get("san"), "uci": m.get("uci"),
                "from_sq": m.get("from_sq"), "to_sq": m.get("to_sq"),
                "is_bot": bool(m.get("is_bot", False)),
                "classification": m.get("classification"),
                "elapsed_ms": m.get("elapsed_ms", 0),
                "fen": m.get("fen"),
            })
        await db.games.update_one(
            {"_id": ObjectId(game_id)},
            {"$set": {"result": result, "moves": slim}},
        )
    except Exception:
        try:
            await db.games.update_one(
                {"_id": ObjectId(game_id)},
                {"$set": {"result": result}},
            )
        except Exception:
            pass


    await manager.broadcast(game_id, {
        "type": "game_over",
        "payload": {
            "result": result,
            "moves": state.moves,
        },
    })


    _game_states.pop(game_id, None)


# Derives game result from board
def _get_result(board: chess.Board) -> str:
    outcome = board.outcome()
    if outcome is None:
        return "ongoing"
    if outcome.winner == chess.WHITE:
        return "white"
    elif outcome.winner == chess.BLACK:
        return "black"
    return "draw"


logger = logging.getLogger(__name__)


# Handles matchmaking socket pairing
# Handles matchmaking queue and pairing
async def handle_matchmaking_socket(
    websocket: WebSocket,
    token: str,
    tc: int = 600,
    inc: int = 0,
):
    user_id = decode_access_token(token)
    if not user_id:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    await websocket.accept()

    db = get_db()

    from bson import ObjectId
    user_doc = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user_doc:
        await websocket.close(code=4004, reason="User not found")
        return

    await enqueue(user_id, tc, inc)
    await websocket.send_json({"type": "queued", "payload": {"time_control_seconds": tc, "increment_seconds": inc}})

    try:
        while True:
            match = await check_for_match(user_id)
            if match:
                if match["is_creator"]:
                    game_doc = GameDoc(
                        white_id=user_id,
                        black_id=match["opponent_id"],
                        mode="random",
                        time_control_seconds=tc,
                        increment_seconds=inc,
                    )
                    result = await db.games.insert_one(game_doc.model_dump(exclude={"id"}))
                    game_id = str(result.inserted_id)


                    await set_matched(match["opponent_id"], game_id, user_id)


                    await dequeue(user_id)


                    await websocket.send_json({
                        "type": "paired",
                        "payload": {
                            "game_id": game_id,
                            "color": "white",
                            "opponent_id": match["opponent_id"],
                            "time_control_seconds": tc,
                            "increment_seconds": inc,
                        },
                    })
                    break
                else:
                    await dequeue(user_id)


                    await websocket.send_json({
                        "type": "paired",
                        "payload": {
                            "game_id": match["game_id"],
                            "color": "black",
                            "opponent_id": match["opponent_id"],
                            "time_control_seconds": tc,
                            "increment_seconds": inc,
                        },
                    })
                    break


            await asyncio.sleep(1.0)


            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=0.05)
                msg = json.loads(raw)
                if msg.get("type") == "cancel":
                    await dequeue(user_id)
                    await websocket.send_json({"type": "cancelled", "payload": {}})
                    return
            except asyncio.TimeoutError:
                pass

    except WebSocketDisconnect:
        await dequeue(user_id)
        logger.info(f"[matchmaking] {user_id} disconnected from matchmaking")
