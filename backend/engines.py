# Provides move classification engine pooling and analysis
import math
from typing import Optional
import asyncio
import logging
import sys
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
import chess
import chess.engine
from core import get_settings
import os
from core import CandidateMove, AnalysisResult

# Groups move classification helpers and converts centipawn score to win probability
def eval_to_win_prob(centipawns: int) -> float:
    from review import eval_to_win_prob as _w
    return _w(centipawns)


# Classifies move quality from win probability
def classify_move(
    eval_before_cp: int,
    eval_after_cp: int,
    is_white_to_move: bool,
    is_capture: bool,
    best_move_cp: Optional[int],
) -> str:
    from review import classify_move as _c
    return _c(eval_before_cp, eval_after_cp, is_white_to_move, is_capture, best_move_cp)


# Calculates accuracy from move classifications
def accuracy_from_classifications(classifications: list[str]) -> float:
    from review import game_accuracy as _g
    weights = {
        "brilliant": 100,
        "best": 100,
        "best_move": 100,
        "excellent": 90,
        "good": 75,
        "inaccuracy": 50,
        "mistake": 25,
        "blunder": 0,
    }
    if not classifications:
        return 100.0
    total = sum(weights.get(str(c).lower(), 75) for c in classifications)
    return round(total / len(classifications), 1)


logger = logging.getLogger(__name__)


settings = get_settings()


BACKEND_DIR = Path(__file__).resolve().parent


# Resolves relative path to absolute path
def _abs(p: str) -> str:
    p = p or ""
    path = Path(p)
    if path.is_absolute():
        return str(path)
    return str((BACKEND_DIR / path).resolve())


# Manages Stockfish engine pooling
# Defines supported engine types
class EngineType(str, Enum):
    STOCKFISH = "stockfish"


ENGINE_PATHS: dict[EngineType, str] = {
    EngineType.STOCKFISH: _abs(settings.sf_path),
}


ENGINE_OPTIONS: dict[EngineType, dict] = {
    EngineType.STOCKFISH: {
        "Hash": 256,
        "Threads": 2,
    },
}


POOL_MANAGED_TYPES: list[EngineType] = [EngineType.STOCKFISH]


_SPAWN_TIMEOUT = 60.0


# Manages exclusive Stockfish engine process
@dataclass
class PooledEngine:
    engine_type: EngineType
    _engine: chess.engine.SimpleEngine = field(repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    in_use: bool = False
    last_used: float = field(default_factory=time.monotonic)


    # Plays best move on board position
    async def play(
        self, board: chess.Board, limit: chess.engine.Limit
    ) -> chess.engine.PlayResult:
        # Executes engine operation in worker thread
        def _do() -> chess.engine.PlayResult:
            with self._lock:
                return self._engine.play(board, limit)

        return await asyncio.to_thread(_do)


    # Analyses board position with engine
    async def analyse(
        self,
        board: chess.Board,
        limit: chess.engine.Limit,
        multipv: Optional[int] = None,
    ):
        # Executes engine operation in worker thread
        def _do():
            with self._lock:
                if multipv is None:
                    return self._engine.analyse(board, limit)
                return self._engine.analyse(board, limit, multipv=multipv)

        return await asyncio.to_thread(_do)


    # Terminates engine process safely
    async def quit(self):
        # Executes engine operation in worker thread
        def _do():
            with self._lock:
                try:
                    self._engine.quit()
                except Exception:
                    pass

        try:
            await asyncio.to_thread(_do)
        except Exception:
            pass


# Manages pooled Stockfish engine instances
class EnginePool:
    # Initializes pooled engine resources
    def __init__(self, engine_type: EngineType, size: int = 2):
        self.engine_type = engine_type
        self.size = size
        self._pool: list[PooledEngine] = []
        self._lock = asyncio.Lock()
        self._semaphore = asyncio.Semaphore(size)


    # Spawns new engine process
    async def _spawn(self) -> PooledEngine:
        path = ENGINE_PATHS[self.engine_type]
        opts = ENGINE_OPTIONS[self.engine_type]


        # Executes engine operation in worker thread
        def _do() -> chess.engine.SimpleEngine:
            if sys.platform == "win32" and not isinstance(
                asyncio.get_event_loop_policy(),
                asyncio.WindowsProactorEventLoopPolicy,
            ):
                asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
            engine = chess.engine.SimpleEngine.popen_uci(path, timeout=_SPAWN_TIMEOUT)
            if opts:
                engine.configure(opts)
            return engine

        simple = await asyncio.to_thread(_do)
        logger.info(f"[engine_pool] Spawned {self.engine_type} at {path}")
        return PooledEngine(
            engine_type=self.engine_type,
            _engine=simple,
        )


    # Acquires idle engine from pool
    async def acquire(self) -> PooledEngine:
        await self._semaphore.acquire()
        try:
            async with self._lock:
                for pe in self._pool:
                    if not pe.in_use:
                        pe.in_use = True
                        pe.last_used = time.monotonic()
                        return pe

                pe = await self._spawn()
                pe.in_use = True
                self._pool.append(pe)
                return pe
        except Exception:
            self._semaphore.release()
            raise


    # Releases engine back to pool
    async def release(self, pe: PooledEngine):
        async with self._lock:
            pe.in_use = False
            pe.last_used = time.monotonic()
        self._semaphore.release()


    # Shuts down pooled engine resources
    async def shutdown(self):
        async with self._lock:
            for pe in self._pool:
                await pe.quit()
            self._pool.clear()


_pools: dict[EngineType, EnginePool] = {}


# Initializes global engine pools
def init_pools():
    for et in POOL_MANAGED_TYPES:
        _pools[et] = EnginePool(et, size=settings.engine_pool_size)
    logger.info("[engine_pool] Engine pools initialized (lazy spawn).")


# Shuts down global engine pools
async def shutdown_pools():
    for pool in _pools.values():
        await pool.shutdown()
    logger.info("[engine_pool] All engine pools shut down.")


# Returns engine pool for type
def get_pool(engine_type: EngineType) -> EnginePool:
    if engine_type not in _pools:
        raise RuntimeError("Engine pools not initialized. Call init_pools() at startup.")
    return _pools[engine_type]


# Provides async engine proxy interface
# Provides async Stockfish engine interface
class AsyncEngineProxy:
    # Returns best move as UCI string
    async def best_move(self, fen: str, depth: int = 15) -> str:
        board = chess.Board(fen)
        pool = get_pool(EngineType.STOCKFISH)
        engine = await pool.acquire()
        try:
            result = await engine.play(board, chess.engine.Limit(depth=depth))
            return result.move.uci()
        finally:
            await pool.release(engine)


    # Evaluates position in pawns
    async def evaluate(self, fen: str, depth: int = 15) -> float:
        board = chess.Board(fen)
        pool = get_pool(EngineType.STOCKFISH)
        engine = await pool.acquire()
        try:
            info = await engine.analyse(board, chess.engine.Limit(depth=depth))
            score = info.get("score")
            if score:
                cp = score.white().score(mate_score=10000)
                if cp is not None:
                    return cp / 100.0
            return 0.0
        finally:
            await pool.release(engine)


    # Returns top candidate moves with quality
    async def get_top_moves(self, fen: str, count: int = 5, depth: int = 12) -> list:
        board = chess.Board(fen)
        legal_moves = list(board.legal_moves)
        if not legal_moves:
            return []

        multipv = min(max(1, count), len(legal_moves))
        pool = get_pool(EngineType.STOCKFISH)
        engine = await pool.acquire()
        try:
            info = await engine.analyse(
                board,
                chess.engine.Limit(depth=depth),
                multipv=multipv,
            )
        finally:
            await pool.release(engine)

        top_moves = []
        best_pov_score = None

        for i, entry in enumerate(info):
            pv = entry.get("pv", [])
            if not pv:
                continue
            move = pv[0]
            score_obj = entry["score"]
            score_white_val = score_obj.white().score(mate_score=10000) / 100.0
            score_pov_val = score_obj.pov(board.turn).score(mate_score=10000) / 100.0
            is_mate = score_obj.is_mate()
            mate_moves = score_obj.pov(board.turn).mate() if is_mate else None
            mate_str = f"#{mate_moves:+d}" if is_mate and mate_moves is not None else None

            if i == 0:
                best_pov_score = score_pov_val

            cp_delta = 0.0
            if best_pov_score is not None:
                cp_delta = max(0.0, round((best_pov_score - score_pov_val) * 100.0, 1))

            if i == 0 or cp_delta <= 20:
                quality = "Best Move"
            elif cp_delta <= 50:
                quality = "Excellent"
            elif cp_delta <= 100:
                quality = "Good"
            elif cp_delta <= 200:
                quality = "Inaccuracy"
            elif cp_delta <= 400:
                quality = "Mistake"
            else:
                quality = "Blunder"

            temp_board = board.copy()
            pv_san_list = []
            for m in pv[:8]:
                try:
                    pv_san_list.append(temp_board.san(m))
                    temp_board.push(m)
                except Exception:
                    break

            top_moves.append({
                "rank": i + 1,
                "move_uci": move.uci(),
                "move_san": board.san(move),
                "score_white": round(score_white_val, 2),
                "score_pov": round(score_pov_val, 2),
                "cp_delta": cp_delta,
                "is_mate": is_mate,
                "mate_str": mate_str,
                "quality": quality,
                "pv_san": " ".join(pv_san_list),
                "pv_uci": [m.uci() for m in pv[:8]],
            })

        return top_moves


logger = logging.getLogger(__name__)


settings = get_settings()


_maia_instance = None


_maia_elo = None


_maia_lock = asyncio.Lock()


# Provides Maia human-like engine integration
# Builds subprocess environment for Maia
def _maia_env():
    env = dict(os.environ)
    maia_dir = os.path.normpath(
        os.path.join(os.path.dirname(__file__), settings.maia3_dir.lstrip("./\\"))
    )
    env["PYTHONPATH"] = maia_dir + os.pathsep + env.get("PYTHONPATH", "")
    return env


# Manages a pool of Maia-3 UCI engine processes at a fixed Elo
class MaiaPool:
    # Initializes pool state for given Elo target
    def __init__(self, elo: int, size: int = 2, model: str = "maia3-5m"):
        self.elo = elo
        self.size = size
        self.model = model
        self._pool: list[chess.engine.SimpleEngine] = []
        self._lock = asyncio.Lock()
        self._semaphore = asyncio.Semaphore(size)

    # Spawns a fresh Maia-3 process for the pool
    async def _spawn(self) -> chess.engine.SimpleEngine:
        cmd = [sys.executable, "-m", "maia3.uci", "--model", self.model, "--elo", str(self.elo)]
        engine = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: chess.engine.SimpleEngine.popen_uci(cmd, env=_maia_env()),
        )
        await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: engine.play(chess.Board(), chess.engine.Limit(nodes=1)),
        )
        logger.info(f"[maia_pool] Spawned Maia-3 elo={self.elo}")
        return engine

    # Acquires a Maia-3 engine from the pool
    async def acquire(self) -> chess.engine.SimpleEngine:
        await self._semaphore.acquire()
        try:
            async with self._lock:
                if self._pool:
                    return self._pool.pop()
                return await self._spawn()
        except Exception:
            self._semaphore.release()
            raise

    # Returns a Maia-3 engine back to the pool
    async def release(self, engine: chess.engine.SimpleEngine):
        async with self._lock:
            if len(self._pool) < self.size:
                self._pool.append(engine)
            else:
                try:
                    engine.quit()
                except Exception:
                    pass
        self._semaphore.release()

    # Shuts down all pooled Maia-3 engines
    async def shutdown(self):
        async with self._lock:
            for engine in self._pool:
                try:
                    engine.quit()
                except Exception:
                    pass
            self._pool.clear()


_maia_pools: dict[int, MaiaPool] = {}
_maia_pools_lock = asyncio.Lock()


# Returns or creates a MaiaPool for the given Elo target
async def _get_maia_pool(elo: int) -> MaiaPool:
    async with _maia_pools_lock:
        if elo not in _maia_pools:
            _maia_pools[elo] = MaiaPool(elo, size=settings.maia_pool_size)
        return _maia_pools[elo]


# Returns Maia move at Elo level using pool
async def get_maia_move(fen: str, elo: int = 1500, model: str = "maia3-5m") -> str:
    pool = await _get_maia_pool(elo)
    engine = await pool.acquire()
    try:
        board = chess.Board(fen)
        result = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: engine.play(board, chess.engine.Limit(nodes=1)),
        )
        return result.move.uci()
    except Exception:
        try:
            engine.quit()
        except Exception:
            pass
        raise
    finally:
        await pool.release(engine)


# Shuts down all cached Maia pools
async def shutdown_maia():
    async with _maia_pools_lock:
        for pool in _maia_pools.values():
            await pool.shutdown()
        _maia_pools.clear()
        logger.info("[maia_pool] All Maia-3 pools shut down.")


logger = logging.getLogger(__name__)


# Provides position analysis utilities
STOCKFISH_DEPTH = 20


# Builds plain-language move explanation
def _build_explanation(board: chess.Board, move: chess.Move, info: Optional[chess.engine.InfoDict] = None) -> str:
    san = board.san(move)
    explanation_parts = []


    if board.is_capture(move):
        captured_piece = board.piece_at(move.to_square)
        if captured_piece:
            piece_names = {
                chess.PAWN: "pawn", chess.KNIGHT: "knight", chess.BISHOP: "bishop",
                chess.ROOK: "rook", chess.QUEEN: "queen",
            }
            explanation_parts.append(f"captures the {piece_names.get(captured_piece.piece_type, 'piece')}")


    board_copy = board.copy()
    board_copy.push(move)
    if board_copy.is_check():
        explanation_parts.append("delivers check, forcing a response")


    piece = board.piece_at(move.from_square)
    if piece and piece.piece_type == chess.PAWN:
        if chess.square_rank(move.to_square) in (6, 7, 0, 1):
            explanation_parts.append("advances the pawn toward promotion")


    file_idx = chess.square_file(move.to_square)
    rank_idx = chess.square_rank(move.to_square)
    if 2 <= file_idx <= 5 and 2 <= rank_idx <= 5:
        explanation_parts.append("places the piece on a central square, maximizing its activity")


    if info:
        score = info.get("score")
        if score:
            cp = score.white().score(mate_score=10000)
            if cp is not None:
                if cp > 200:
                    explanation_parts.append("maintains a strong positional advantage")
                elif cp > 50:
                    explanation_parts.append("keeps a slight edge")
                elif abs(cp) < 30:
                    explanation_parts.append("keeps the position roughly balanced")

    if not explanation_parts:
        explanation_parts.append("improves piece coordination")

    return f"{san}: " + "; ".join(explanation_parts) + "."


# Analyzes position with Stockfish MultiPV
async def analyze_position(
    fen: str,
    multipv: int = 3,
    depth: Optional[int] = None,
) -> AnalysisResult:
    board = chess.Board(fen)

    sf_pool = get_pool(EngineType.STOCKFISH)
    sf_engine = await sf_pool.acquire()

    try:
        sf_coro = sf_engine.analyse(
            board,
            chess.engine.Limit(depth=depth or STOCKFISH_DEPTH),
            multipv=multipv,
        )

        results = await asyncio.gather(sf_coro, return_exceptions=True)
        sf_infos = results[0] if not isinstance(results[0], Exception) else []

    finally:
        await sf_pool.release(sf_engine)


    candidates: list[CandidateMove] = []
    if isinstance(sf_infos, list):
        for info in sf_infos:
            pv = info.get("pv", [])
            if not pv:
                continue
            move = pv[0]
            score = info.get("score")
            cp = 0
            if score:
                raw = score.white().score(mate_score=10000)
                cp = raw if raw is not None else 0

            win_prob = eval_to_win_prob(cp)
            explanation = _build_explanation(board, move, info)

            candidates.append(CandidateMove(
                uci=move.uci(),
                san=board.san(move),
                eval_cp=cp,
                win_prob=round(win_prob, 4),
                explanation=explanation,
            ))

    return AnalysisResult(
        fen=fen,
        stockfish_candidates=candidates,
    )


# Evaluates single move in centipawns
async def evaluate_single_move(fen: str, move_uci: str) -> int:
    board = chess.Board(fen)
    sf_pool = get_pool(EngineType.STOCKFISH)
    engine = await sf_pool.acquire()
    try:
        move = chess.Move.from_uci(move_uci)
        board.push(move)
        info = await engine.analyse(board, chess.engine.Limit(depth=14))
        score = info.get("score")
        if score:
            cp = score.white().score(mate_score=10000)
            return cp if cp is not None else 0
        return 0
    finally:
        await sf_pool.release(engine)
