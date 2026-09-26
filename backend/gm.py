# Provides GM policy network dataset and storage
import os
import io
import chess
import chess.pgn
import numpy as np
from pathlib import Path
import logging
from typing import Optional
try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    from torch.utils.data import Dataset
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False


# Defines GM network and dataset utilities
PIECE_TO_PLANE = {
    chess.Piece(chess.PAWN, chess.WHITE): 0,
    chess.Piece(chess.KNIGHT, chess.WHITE): 1,
    chess.Piece(chess.BISHOP, chess.WHITE): 2,
    chess.Piece(chess.ROOK, chess.WHITE): 3,
    chess.Piece(chess.QUEEN, chess.WHITE): 4,
    chess.Piece(chess.KING, chess.WHITE): 5,
    chess.Piece(chess.PAWN, chess.BLACK): 6,
    chess.Piece(chess.KNIGHT, chess.BLACK): 7,
    chess.Piece(chess.BISHOP, chess.BLACK): 8,
    chess.Piece(chess.ROOK, chess.BLACK): 9,
    chess.Piece(chess.QUEEN, chess.BLACK): 10,
    chess.Piece(chess.KING, chess.BLACK): 11,
}


_DATA_DIR = Path(__file__).resolve().parent / "data"


_DEFAULT_GM_PGN = _DATA_DIR / "grandmaster_games_1000.pgn"


SAMPLE_GM_PGNS = """
[Event "World Championship 35th"]
[Site "Moscow URS"]
[Date "1985.10.15"]
[Round "16"]
[White "Karpov, Anatoly"]
[Black "Kasparov, Garry"]
[Result "0-1"]

1. e4 c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4 Nc6 5. Nb5 d6 6. c4 Nf6 7. N1c3 a6 8. Na3 d5
9. cxd5 exd5 10. exd5 Nb4 11. Be2 Bc5 12. O-O O-O 13. Bf3 Bf5 14. Bg5 Re8 15. Qd2 b5
16. Rad1 Nd3 17. Nab1 h6 18. Bh4 b4 19. Na4 Bd6 20. Bg3 Rc8 21. b3 g5 22. Bxd6 Qxd6
23. g3 Nd7 24. Bg2 Qf6 25. a3 a5 26. axb4 axb4 27. Qa2 Bg6 28. d6 g4 29. Qd2 Kg7
30. f3 Qxd6 31. fxg4 Qd4+ 32. Kh1 Nf6 33. Rf4 Ne4 34. Qxd3 Nf2+ 35. Rxf2 Bxd3
36. Rfd2 Qe3 37. Rxd3 Rc1 38. Nb2 Qf2 39. Nd2 Rxd1+ 40. Nxd1 Re1+ 0-1

[Event "World Championship"]
[Site "Reykjavik ISL"]
[Date "1972.07.23"]
[Round "6"]
[White "Fischer, Robert James"]
[Black "Spassky, Boris V"]
[Result "1-0"]

1. c4 e6 2. Nf3 d5 3. d4 Nf6 4. Nc3 Be7 5. Bg5 O-O 6. e3 h6 7. Bh4 b6 8. cxd5 Nxd5
9. Bxe7 Qxe7 10. Nxd5 exd5 11. Rc1 Be6 12. Qa4 c5 13. Qa3 Rc8 14. Bb5 a6 15. dxc5 bxc5
16. O-O Ra7 17. Be2 Nd7 18. Nd4 Qf8 19. Nxe6 fxe6 20. e4 d4 21. f4 Qe7 22. e5 Rb8
23. Bc4 Kh8 24. Qh3 Nf8 25. b3 a5 26. f5 exf5 27. Rxf5 Nh7 28. Rcf1 Qd8 29. Qg3 Re7
30. h4 Rbb7 31. e6 Rbc7 32. Qe5 Qe8 33. a4 Qd8 34. R1f2 Qe8 35. R2f3 Qd8 36. Bd3 Qe8
37. Qe4 Nf6 38. Rxf6 gxf6 39. Rxf6 Kg8 40. Bc4 Kh8 41. Qf4 1-0

[Event "Grenke Chess Classic"]
[Site "Karlsruhe/Baden-Baden GER"]
[Date "2019.04.28"]
[Round "7"]
[White "Carlsen, Magnus"]
[Black "Meier, Georg"]
[Result "1-0"]

1. d4 Nf6 2. c4 e6 3. Nf3 d5 4. Nc3 c6 5. e3 Nbd7 6. Qc2 Bd6 7. g4 h6 8. Rg1 e5
9. cxd5 Nxd5 10. Bd2 exd4 11. Nxd5 cxd5 12. Nxd4 Ne5 13. Be2 O-O 14. O-O-O Bd7
15. Kb1 Rc8 16. Bc3 Bb4 17. Bxb4 Rxc2 18. Nxc2 Re8 19. g5 hxg5 20. Rxd5 Qc8
21. Bc3 f6 22. Bxe5 Rxe5 23. Rxe5 fxe5 24. Rxg5 Bf5 25. Bd1 Qd7 26. Kc1 g6
27. Rg1 Qd5 28. b3 a5 29. Be2 Qc5 30. Bc4+ Kg7 31. Rd1 b5 32. Rd5 Qc7
33. Rxb5 a4 34. Kb2 axb3 35. axb3 Qd6 36. Rd5 Qf6 37. Rd2 Qh4 38. f3 Qh3
39. Bd5 Bxc2 40. Kxc2 Qf1 41. Be4 Qa1 42. Kd3 Qb1+ 43. Ke2 Qxb3 1-0

[Event "Candidates Match"]
[Site "Bled YUG"]
[Date "1959.10.11"]
[Round "20"]
[White "Tal, Mikhail"]
[Black "Smyslov, Vasily"]
[Result "1-0"]

1. e4 c6 2. d3 d5 3. Nd2 e5 4. Ngf3 Nd7 5. d4 dxe4 6. Nxe4 exd4 7. Qxd4 Ngf6
8. Bg5 Be7 9. O-O-O O-O 10. Nd6 Qa5 11. Bc4 b5 12. Bd2 Qa6 13. Nf5 Bd8
14. Qh4 bxc4 15. Qg5 Nh5 16. Nh6+ Kh8 17. Qxh5 Qxa2 18. Bc3 Nf6 19. Qxf7 Qa1+
20. Kd2 Re8 21. Ne5 Be6 22. Rxa1 Bxf7 23. Nhxf7+ Kg8 24. Nxd8 Raxd8+
25. Kc1 Ne4 26. Nxc6 1-0
"""


# Encodes board into tensor representation
def board_to_tensor(board: chess.Board) -> np.ndarray:
    tensor = np.zeros((14, 8, 8), dtype=np.float32)

    for square, piece in board.piece_map().items():
        plane = PIECE_TO_PLANE[piece]
        rank = chess.square_rank(square)
        file = chess.square_file(square)
        tensor[plane, rank, file] = 1.0

    if board.has_kingside_castling_rights(chess.WHITE):
        tensor[12, 0, 0:4] = 1.0
    if board.has_queenside_castling_rights(chess.WHITE):
        tensor[12, 0, 4:8] = 1.0
    if board.has_kingside_castling_rights(chess.BLACK):
        tensor[12, 7, 0:4] = 1.0
    if board.has_queenside_castling_rights(chess.BLACK):
        tensor[12, 7, 4:8] = 1.0


    if board.turn == chess.WHITE:
        tensor[13, :, :] = 1.0

    return tensor


# Encodes move into action identifier
def move_to_action(move: chess.Move) -> int:
    return move.from_square * 64 + move.to_square


if TORCH_AVAILABLE:
    # Provides PyTorch dataset for GM games
    class GMChessDataset(Dataset):
        # Initializes model component resources
        def __init__(self, pgn_data_str=None, pgn_file_path=None, max_games=1000):
            self.samples = []
            resolved_path = pgn_file_path
            if not resolved_path and not pgn_data_str:
                if _DEFAULT_GM_PGN.exists():
                    resolved_path = str(_DEFAULT_GM_PGN)
            self._load_data(pgn_data_str, resolved_path, max_games)


        # Loads games into training samples
        def _load_data(self, pgn_str, pgn_path, max_games):
            pgn_io = None
            if pgn_path and os.path.exists(pgn_path):
                pgn_io = open(pgn_path, "r", encoding="utf-8", errors="ignore")
            elif pgn_str:
                pgn_io = io.StringIO(pgn_str)
            else:
                pgn_io = io.StringIO(SAMPLE_GM_PGNS)

            game_count = 0
            while game_count < max_games:
                try:
                    game = chess.pgn.read_game(pgn_io)
                    if game is None:
                        break

                    result_str = game.headers.get("Result", "*")
                    outcome = {"1-0": 1.0, "0-1": -1.0, "1/2-1/2": 0.0}.get(result_str, 0.0)

                    board = game.board()
                    for node in game.mainline():
                        move = node.move
                        tensor = board_to_tensor(board)
                        action = move_to_action(move)
                        player_outcome = outcome if board.turn == chess.WHITE else -outcome
                        self.samples.append({
                            "tensor": tensor,
                            "action": action,
                            "outcome": player_outcome,
                            "fen": board.fen(),
                            "move_san": board.san(move),
                        })
                        board.push(move)
                    game_count += 1
                except Exception:
                    continue

            if pgn_path and hasattr(pgn_io, "close"):
                pgn_io.close()


        # Returns number of dataset samples
        def __len__(self):
            return len(self.samples)


        # Returns training sample by index
        def __getitem__(self, idx):
            item = self.samples[idx]
            return {
                "tensor": torch.tensor(item["tensor"], dtype=torch.float32),
                "action": torch.tensor(item["action"], dtype=torch.long),
                "outcome": torch.tensor(item["outcome"], dtype=torch.float32),
            }

else:
    GMChessDataset = None


if TORCH_AVAILABLE:
    # Implements residual convolutional block
    class ResidualBlock(nn.Module):
        # Initializes model component resources
        def __init__(self, channels=128):
            super().__init__()
            self.conv1 = nn.Conv2d(channels, channels, 3, padding=1, bias=False)
            self.bn1 = nn.BatchNorm2d(channels)
            self.conv2 = nn.Conv2d(channels, channels, 3, padding=1, bias=False)
            self.bn2 = nn.BatchNorm2d(channels)


        # Computes network forward pass outputs
        def forward(self, x):
            out = F.relu(self.bn1(self.conv1(x)))
            out = self.bn2(self.conv2(out))
            return F.relu(out + x)


    # Implements GM policy-value network
    class GMPolicyValueNet(nn.Module):
        # Initializes model component resources
        def __init__(self, in_channels=14, num_res_blocks=4, channels=128):
            super().__init__()
            self.conv_input = nn.Conv2d(in_channels, channels, 3, padding=1, bias=False)
            self.bn_input = nn.BatchNorm2d(channels)
            self.res_blocks = nn.ModuleList([ResidualBlock(channels) for _ in range(num_res_blocks)])
            self.policy_conv = nn.Conv2d(channels, 64, 1, bias=False)
            self.policy_bn = nn.BatchNorm2d(64)
            self.policy_fc = nn.Linear(64 * 8 * 8, 4096)
            self.value_conv = nn.Conv2d(channels, 16, 1, bias=False)
            self.value_bn = nn.BatchNorm2d(16)
            self.value_fc1 = nn.Linear(16 * 8 * 8, 128)
            self.value_fc2 = nn.Linear(128, 1)


        # Computes network forward pass outputs
        def forward(self, x):
            out = F.relu(self.bn_input(self.conv_input(x)))
            for block in self.res_blocks:
                out = block(out)
            p = F.relu(self.policy_bn(self.policy_conv(out)))
            p = p.view(p.size(0), -1)
            policy_logits = self.policy_fc(p)
            v = F.relu(self.value_bn(self.value_conv(out)))
            v = v.view(v.size(0), -1)
            v = F.relu(self.value_fc1(v))
            value = torch.tanh(self.value_fc2(v))
            return policy_logits, value


        # Predicts top grandmaster moves
        def predict_gm_move(self, board, top_k=3, device="cpu"):
            self.eval()
            tensor_np = board_to_tensor(board)
            tensor_t = torch.tensor(tensor_np, dtype=torch.float32).unsqueeze(0).to(device)

            with torch.no_grad():
                policy_logits, value = self.forward(tensor_t)
                logits = policy_logits[0].cpu().numpy()
                pos_val = value[0].item()

            legal_moves = list(board.legal_moves)
            if not legal_moves:
                return {"top_gm_moves": [], "gm_best_san": "None", "gm_best_uci": None,
                        "confidence": 0.0, "position_value": pos_val,
                        "source": "gm-resnet", "model": "gm_policy_resnet"}

            legal_scores = [(m, logits[move_to_action(m)]) for m in legal_moves]
            scores_arr = np.array([s[1] for s in legal_scores])
            exp_scores = np.exp(scores_arr - np.max(scores_arr))
            probs = exp_scores / np.sum(exp_scores)

            ranked = []
            for idx, (move_obj, _) in enumerate(legal_scores):
                ranked.append({
                    "move_san": board.san(move_obj),
                    "move_uci": move_obj.uci(),
                    "prob": float(probs[idx]),
                    "confidence_pct": round(float(probs[idx]) * 100.0, 1),
                })
            ranked.sort(key=lambda x: x["prob"], reverse=True)
            top_moves = ranked[:top_k]

            return {
                "top_gm_moves": top_moves,
                "gm_best_san": top_moves[0]["move_san"],
                "gm_best_uci": top_moves[0]["move_uci"],
                "confidence": top_moves[0]["confidence_pct"],
                "position_value": round(pos_val, 2),
                "source": "gm-resnet",
                "model": "gm_policy_resnet",
            }

else:
    GMPolicyValueNet = None
    ResidualBlock = None


logger = logging.getLogger(__name__)


BACKEND_DIR = Path(__file__).resolve().parent


# Manages persisted GM model registry
CHECKPOINT_DIR = BACKEND_DIR / "checkpoints"


DEFAULT_GM_PGN = BACKEND_DIR / "data" / "grandmaster_games_1000.pgn"


_MODEL_CACHE: dict[str, object] = {}


_MODEL_CACHE_ORDER: list[str] = []


_CACHE_MAX = 3


_LOAD_ERRORS: dict[str, str] = {}


# Converts model document for API
def _model_doc_to_public(doc: dict) -> dict:
    doc = dict(doc)
    doc.pop("_id", None)
    return doc


# Returns application database handle
async def _db():
    from core import get_db
    return get_db()


# Lists registered chess models
async def list_models(include_unpublished: bool) -> list[dict]:
    try:
        db = await _db()
        filt = {} if include_unpublished else {"published": True}
        out = []
        async for doc in db.gm_models.find(filt).sort("created_at", -1):
            out.append(_model_doc_to_public(doc))
        return out
    except Exception as e:
        logger.warning(f"[model-store] list failed: {e}")
        return []


# Fetches single model document
async def get_model_doc(model_id: Optional[str], include_unpublished: bool) -> Optional[dict]:
    try:
        db = await _db()
        if model_id:
            doc = await db.gm_models.find_one({"model_id": model_id})
            if not doc:
                return None
            if not doc.get("published") and not include_unpublished:
                return None
            return _model_doc_to_public(doc)

        filt = {} if include_unpublished else {"published": True}
        doc = await db.gm_models.find_one(filt, sort=[("created_at", -1)])
        return _model_doc_to_public(doc) if doc else None
    except Exception as e:
        logger.warning(f"[model-store] get failed: {e}")
        return None


# Inserts or updates model document
async def upsert_model(doc: dict) -> None:
    try:
        db = await _db()


        doc.pop("_id", None)
        await db.gm_models.replace_one({"model_id": doc["model_id"]}, doc, upsert=True)
        doc.pop("_id", None)
    except Exception as e:
        logger.warning(f"[model-store] upsert failed: {e}")


# Deletes model document by identifier
async def delete_model_doc(model_id: str) -> Optional[dict]:
    try:
        db = await _db()
        doc = await db.gm_models.find_one({"model_id": model_id})
        if doc:
            await db.gm_models.delete_one({"model_id": model_id})
            return _model_doc_to_public(doc)
        return None
    except Exception as e:
        logger.warning(f"[model-store] delete failed: {e}")
        return None


# Builds policy network from configuration
def _build_net(config: dict | None):
    from gm import GMPolicyValueNet
    if GMPolicyValueNet is None:
        return None
    cfg = config or {}
    try:
        blocks = max(1, min(8, int(cfg.get("num_blocks", 4))))
    except Exception:
        blocks = 4
    try:
        channels = int(cfg.get("channels", 128))
        channels = 64 if channels == 64 else 128
    except Exception:
        channels = 128
    return GMPolicyValueNet(num_res_blocks=blocks, channels=channels)


# Loads and caches GM model checkpoint
def load_gm_model(checkpoint_path: str, config: dict | None = None):
    global _MODEL_CACHE, _MODEL_CACHE_ORDER
    if checkpoint_path in _MODEL_CACHE:
        return _MODEL_CACHE[checkpoint_path]
    from gm import GMPolicyValueNet
    if GMPolicyValueNet is None:
        _LOAD_ERRORS[checkpoint_path] = "torch not installed in this environment"
        return None
    try:
        import torch
        if not os.path.exists(checkpoint_path):
            _LOAD_ERRORS[checkpoint_path] = f"checkpoint not found at {checkpoint_path}"
            return None
        payload = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
        cfg = dict(config or {})
        state = payload
        if isinstance(payload, dict) and "state_dict" in payload:
            state = payload["state_dict"]
            if isinstance(payload.get("config"), dict):
                merged = dict(payload["config"])
                merged.update(cfg)
                cfg = merged
        model = _build_net(cfg)
        model.load_state_dict(state)
        model.eval()
        _MODEL_CACHE[checkpoint_path] = model
        _MODEL_CACHE_ORDER.append(checkpoint_path)
        while len(_MODEL_CACHE_ORDER) > _CACHE_MAX:
            oldest = _MODEL_CACHE_ORDER.pop(0)
            _MODEL_CACHE.pop(oldest, None)
        _LOAD_ERRORS.pop(checkpoint_path, None)
        logger.info(f"[model-store] loaded GM model from {checkpoint_path}")
        return model
    except Exception as e:
        _LOAD_ERRORS[checkpoint_path] = f"{type(e).__name__}: {e}"
        logger.exception(f"[model-store] failed to load {checkpoint_path}: {e}")
        return None


# Returns cached model load error
def load_error(checkpoint_path: str) -> Optional[str]:
    return _LOAD_ERRORS.get(checkpoint_path)


# Evicts cached model and errors
def evict_model(checkpoint_path: str) -> None:
    _MODEL_CACHE.pop(checkpoint_path, None)
    if checkpoint_path in _MODEL_CACHE_ORDER:
        _MODEL_CACHE_ORDER.remove(checkpoint_path)
    _LOAD_ERRORS.pop(checkpoint_path, None)
