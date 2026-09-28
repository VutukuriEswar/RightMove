## What is RightMove?

RightMove is a comprehensive web application for playing, learning, and analyzing chess. It turns a simple board into a complete training environment where players can challenge human-like bots, get real-time coaching on every move, play friends online, review finished games with engine-grade analysis, and even train custom neural-network playing styles on their own PGN collections. The system features dual-engine integration, transparent move explanations, shareable game reports, and robust admin tooling.

## Key Features

♟️ **Play a Bot (Stockfish & Maia-3)**
- Challenge Stockfish (depth-tiered difficulty) or Maia-3 (human-like play with Elo-scaled difficulty, models `maia3-3m` / `5m` / `23m` / `79m`).
- Pick your color before the game and reconfigure the bot mid-game.
- Live clocks with increment support and authoritative server-side game state.

🧠 **Real-Time Training & Coaching**
- Get top candidate moves with win-probability bars while you play.
- Request hints, plain-language move explanations, and full position breakdowns powered by a local HuggingFace model with a rule-based offline fallback.
- Tactical motif detection, positional concept analysis, move simulation, and structured lessons from the Coach panel.

👥 **Play a Friend & Random Matchmaking**
- Send and accept friend requests, then invite friends to online games.
- Join the matchmaking queue for first-come-first-served pairing per time control.
- Resign, offer draws, request takebacks, and rematch without leaving the room.

🏠 **Pass & Play**
- Local hot-seat games on one device with zero network traffic.
- Games persist in the browser via IndexedDB, so an interrupted local game survives refreshes.

📊 **Game Review & Shareable Reports**
- Replay every finished game with per-move accuracy scored from Stockfish win-probability analysis.
- Key moments, W/D/L evaluation charts, and full-text reports with PDF export.
- Share any review through a link that opens without an account.

📚 **Learn From PGNs**
- Upload your own PGN files for batch game analysis.
- Analyze any single position on demand.

🏆 **GM Challenge & Custom Models**
- Face the built-in GM-style policy network and get scored on your play.
- Train your own playing-style models: upload PGNs, tune epochs / batch size / residual blocks / learning rate, track jobs (pause, resume, delete), then publish models for bot play.

🔐 **Robust Accounts & Admin**
- Secure signup/login with JWT sessions, bcrypt hashing, profiles, stats, and avatar uploads.
- Automatic admin seeding on first startup.
- Admin dashboards for user management (roles, bans, per-user overviews) and the full training pipeline.

🎨 **2D & 3D Boards**
- Switch between a classic 2D board and an animated Three.js 3D board.
- Collectible board and piece themes with live previews, plus light/dark UI themes and a custom cursor.

## Tech Stack

**Backend:**
- **FastAPI** (Python web framework) with native WebSockets
- **Uvicorn** (ASGI server)
- **MongoDB** with Motor for async database operations + GridFS for PGN storage
- **python-chess** for move validation and game logic
- **Stockfish** (UCI, C++ source + Windows binary with embedded NNUE ship in-repo)
- **Maia-3** (UCI, Python package ships in-repo; checkpoints download from Hugging Face on first use)
- **PyTorch** for the GM policy-value network and custom training jobs
- **Transformers** (Qwen2.5-1.5B-Instruct) for local move explanations
- **python-jose** for JWT sessions
- **Bcrypt** for secure password hashing
- **Pydantic v2** for request/response schemas and settings
- **ReportLab** for PDF report export

**Frontend:**
- React 19 for UI components
- Create React App (react-scripts) for build tooling
- React Router v7 for routing with auth/admin guards
- Zustand for client stores (auth, game, themes, leave-game guard)
- chess.js for client-side move logic
- react-chessboard for the 2D board
- Three.js with react-three-fiber/drei for the 3D board
- Framer Motion for page transitions
- Custom CSS design system (tokens, globals, components, pages)

## Quick Start Guide

### Prerequisites
- Python 3.12+
- Node.js 20+ with npm
- MongoDB (local or Atlas connection string)
- ~3 GB free disk for the auto-downloaded explanation model (Qwen2.5-1.5B-Instruct)
- Maia-3 checkpoints download from Hugging Face on first bot game (no token needed)

### Installation Steps

1. **Clone the repository**

2. **Set up virtual environment**
```bash
python -m venv venv
venv\Scripts\activate  # On Linux: source venv/bin/activate
```

3. **Install backend dependencies**
```bash
cd backend
pip install -r requirements.txt
```

4. **Configure the backend**
```bash
cp .env.example .env       # Fill in your values (see Configuration Details)
```

5. **Run backend server**
```bash
uvicorn server:app --reload
```

6. **Install frontend dependencies & start**
Open a new terminal:
```bash
cd frontend
npm install
cp .env.example .env       # Fill in your values
npm start
```

The app opens at `http://localhost:3000` with the API at `http://localhost:8000`.

## Game Modes

| Mode | Description |
|---|---|
| **Play a Bot** | Stockfish (depth tiers) or Maia-3 (human-like play, Elo-scaled difficulty) |
| **Training** | Bot game + real-time top candidate move explanations |
| **Play a Friend** | Online, invite by username |
| **Random Match** | Matchmaking queue, first-come-first-served per time control |
| **Pass & Play** | Local hot-seat, no network (persisted in IndexedDB) |

## Player Record

There is no rating ladder. Profiles and history show **wins / draws / losses** counted from finished games, plus per-move accuracy from Stockfish win-probability analysis. Bot difficulty uses its own scales (Stockfish depth, Maia Elo) and is unrelated to any player number.

## Pages & Routes

- `/` — Home landing page
- `/login`, `/signup` — Authentication
- `/lobby` — Game mode selection and matchmaking entry (auth)
- `/game/:id` — Live game room: board, clocks, coach, chat (auth)
- `/review/:id` — Post-game analysis and reports (auth)
- `/shared/:id` — Public shareable review, no login required
- `/friends` — Friend requests and friend list (auth)
- `/profile` — Your profile, stats, and avatar (auth)
- `/history` — Match history with W/D/L (auth)
- `/learn` — PGN upload and position analysis (auth)
- `/admin/users` — User management (admin)
- `/admin/training` — Model training pipeline (admin)

## API Endpoints

**Authentication:**
- `POST /auth/signup` - Create new account
- `POST /auth/login` - User login
- `GET /auth/me` - Get current user
- `PATCH /auth/me` - Update profile (display name, email, bio, password)
- `POST /auth/me/avatar` - Upload profile avatar

**Games:**
- `POST /games/` - Create a new game (bot, friend, or matchmaking)
- `GET /games/mine/stats` - Your wins / draws / losses
- `GET /games/{id}` - View a specific game
- `GET /games/{id}/summary` - Get the finished-game summary
- `POST /games/{id}/summary` - Submit the finished-game summary
- `POST /games/{id}/choose-color` - Pick your color before play starts
- `PATCH /games/{id}/bot-config` - Reconfigure the bot mid-game

**Friends:**
- `POST /friends/request` - Send a friend request by username
- `POST /friends/accept` - Accept a friend request
- `GET /friends/` - List all friends

**Analysis:**
- `POST /analysis/` - Engine analysis of a position (eval, best line, top moves)

**Coach & Training:**
- `POST /coach/hint` - Get a hint for the current position
- `POST /coach/explain` - Plain-language explanation of a move
- `POST /coach/position` - Full position breakdown
- `POST /coach/simulate` - Simulate a candidate line
- `POST /coach/candidates` - Top candidate moves with reasoning
- `POST /coach/motifs` - Tactical motifs in a move
- `POST /coach/concepts` - Positional concepts in a move
- `POST /coach/lesson` - Structured lesson from a position
- `GET /coach/gm-health` - GM matcher warm-up status
- `POST /coach/gm-move` - Predict the GM-style move
- `POST /coach/gm-match` - Match a game against historical GM play
- `GET /coach/gm-models` - List published GM-style models
- `GET /coach/gm-challenge` - Fetch the daily GM challenge
- `POST /coach/gm-challenge/score` - Score your challenge attempt

**Reports:**
- `POST /report/analyze-game` - Full per-move game analysis
- `POST /report/full-report` - Complete text report with key moments
- `POST /report/pdf` - Export the report as PDF

**Learn:**
- `POST /learn/analyze-pgn` - Batch analysis of an uploaded PGN
- `POST /learn/analyze-position` - One-off position analysis

**Admin & Training (Admin):**
- `GET /admin/users` - List all users (Admin only)
- `PATCH /admin/users/{id}` - Update user role/status (Admin only)
- `GET /admin/users/{id}/overview` - Per-user activity overview (Admin only)
- `POST /admin/train` - Start a custom model training job (Admin only)
- `GET /admin/train/jobs` - List training jobs (Admin only)
- `GET /admin/train/jobs/{id}` - Training job details (Admin only)
- `POST /admin/train/jobs/{id}/pause` - Pause a job (Admin only)
- `POST /admin/train/jobs/{id}/resume` - Resume a job (Admin only)
- `DELETE /admin/train/jobs/{id}` - Delete a job (Admin only)
- `GET /admin/train/env` - Training environment info (Admin only)
- `POST /admin/train/migrate-now` - Force storage migration (Admin only)
- `GET /admin/models` - List trained models (Admin only)
- `POST /admin/models/{id}/publish` - Publish a model for bot play (Admin only)
- `PATCH /admin/models/{id}` - Rename a model (Admin only)
- `DELETE /admin/models/{id}` - Delete a model (Admin only)

**Real-time & Health:**
- `WS /ws/game/{game_id}?token=...` - Live game channel (moves, clocks, chat, results)
- `WS /ws/matchmaking?token=...&tc=600&inc=0` - Matchmaking queue channel
- `GET /health` - Server health check

## Configuration Details

**Backend (`backend/.env`, see `backend/.env.example`):**

| Variable | Purpose | Default |
|---|---|---|
| `SECRET_KEY` | JWT signing secret (change in production!) | `change-me-...` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Session lifetime | `10080` (7 days) |
| `MONGODB_URL` / `MONGODB_DB_NAME` | MongoDB connection | `mongodb://localhost:27017` / `rightmove` |
| `MONGODB_CAPACITY_MB` / `MONGODB_STORAGE_THRESHOLD_PCT` | Storage budget; above it uploads spill to disk | `512` / `75` |
| `MONGODB_MIGRATOR_INTERVAL_SECONDS` | How often disk uploads migrate back to GridFS | `300` |
| `SF_PATH` | Path to the Stockfish binary | `./engines/Stockfish/src/stockfish.exe` |
| `MAIA3_DIR` | Dir containing the `maia3/` Python package | `./engines/Maia-3/maia3` |
| `FRONTEND_URL` | Allowed CORS origin | `http://localhost:5173` |
| `ENGINE_POOL_SIZE` | Concurrent engine instances per type | `2` |
| `ADMIN_USERNAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seeded admin account | set in `.env` |
| `HF_EXPLANATIONS_ENABLED` | Master switch for local AI explanations | `true` |
| `HF_LOCAL_MODEL_ID` | Explanation model (auto-downloaded, ~3 GB) | `Qwen/Qwen2.5-1.5B-Instruct` |
| `HF_LOCAL_FALLBACK` | Fall back to rule-based text when AI is off | `false` |

**Frontend (`frontend/.env`, see `frontend/.env.example`):**

| Variable | Purpose | Default |
|---|---|---|
| `REACT_APP_API_URL` | Backend base URL used by the API client | `http://localhost:8000` |
| `GENERATE_SOURCEMAP` | Emit `.map` files on `npm run build` | `false` |

**Database Initialization:**
- On startup the server creates indexes, seeds the admin account when none exists, recovers interrupted training jobs, and migrates any disk-spilled uploads back into GridFS once storage is under budget.
- The GM historical index warms in the background so the first `/coach/gm-match` request skips the PGN-parsing cost.

**Engines Setup:**
- Stockfish and Maia-3 ship **inside the repo** (`backend/engines/`): C++ source + `stockfish.exe` for Stockfish, and the `maia3` Python package for Maia-3. Nothing to install manually — just keep the `SF_PATH` / `MAIA3_DIR` paths above pointing at them.
- Only the binary (`stockfish.exe`) and the NNUE network file are needed at runtime; the C++ source is included so the engine can be rebuilt.
- Maia-3 checkpoints download from Hugging Face on first use (no token needed).

## Project Structure

```
RightMove/
├── backend/
│   ├── server.py          # FastAPI app, lifespan, WebSocket routes, health
│   ├── api.py             # 8 REST routers, 50 endpoints
│   ├── core.py            # Settings, JWT/bcrypt security, Mongo/GridFS, schemas
│   ├── engines.py         # Stockfish pool, Maia-3 subprocess, move analysis
│   ├── gm.py              # GM policy-value net, dataset, training jobs
│   ├── intelligence.py    # Matchmaking, summaries, HF explanations, coaching
│   ├── realtime.py        # Live game sockets, clocks, matchmaking channel
│   ├── requirements.txt
│   ├── .env.example
│   ├── engines/
│   │   ├── Stockfish/     # C++ source + stockfish.exe + NNUE network
│   │   └── Maia-3/maia3/  # maia3 Python package
│   ├── models/            # Auto-downloaded HF model (git-ignored)
│   └── checkpoints/       # Trained GM checkpoints (git-ignored)
├── frontend/
│   ├── src/
│   │   ├── pages/         # 13 routes: Home → GameRoom → Review → Admin
│   │   ├── components/    # 3d, board (2D/3D/theme picker), game (10), shared
│   │   ├── hooks/         # useAuth, useGameSocket, useLeaveGameGuard
│   │   ├── lib/           # API client, chess utils, analysis, persistence
│   │   ├── store/         # Zustand: auth, game, board theme, theme, leave-game
│   │   ├── styles/        # tokens, globals, components, pages
│   │   ├── App.js         # Router with auth/admin guards
│   │   └── index.js
│   ├── public/            # index.html, board/piece themes, 3D models
│   └── scripts/           # 3D model inspection tooling
├── .gitignore
├── LICENSE
└── README.md
```

## Architecture Notes

Move logs are stored **client-side in IndexedDB** (no server storage cost for raw per-ply data). Only the game summary and key moments are persisted in MongoDB. This means replays are fully local once the game ends, with the server sending the final move sequence to the client via WebSocket.

Large PGN uploads use an adaptive budget: while MongoDB is under its configured capacity they go to GridFS; above the threshold they spill to `backend/data/uploads/`, and a background migrator moves them back once storage frees up.

## License

The RightMove application code is licensed under the **MIT License** — see the [LICENSE](./LICENSE) file for details.

© 2026 Eswar Vutukuri, Lohitha Kanneganti, Yasaswi Venkat Vutla, Hema Sri Ch

Note: the bundled Stockfish engine (source + binary under `backend/engines/Stockfish/`) is licensed under the **GPL** — see [`Copying.txt`](./backend/engines/Stockfish/Copying.txt). Maia-3 ships under its own [LICENSE](./backend/engines/Maia-3/maia3/LICENSE).

## Acknowledgments

This project is being developed under the guidance of **Prof. Gundimeda Venugopal, VIT-AP University**. We sincerely thank him for his invaluable guidance, mentorship, and continuous support throughout our development process.

Thanks to the Stockfish developers for the world's strongest open-source chess engine, the UofT CSS Lab for Maia-3 human-like play, Hugging Face for model hosting, MongoDB for the database, FastAPI for the web framework, and the three.js and React communities for rendering and UI tooling.