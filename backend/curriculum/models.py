# Defines data models and schemas for curriculum engine
from typing import Optional, Literal
from datetime import datetime, timezone
from pydantic import BaseModel, Field


# Returns current UTC datetime
def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# Normalizes datetime to UTC timezone-aware
def to_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)
    return None


# Models individual mistake position with extracted features
class MistakePosition(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    user_id: str
    game_id: str
    game_date: datetime = Field(default_factory=utcnow)
    move_number: int
    player_color: Literal["white", "black"]
    fen_before: str
    move_played: str
    best_move: str
    centipawn_loss: int
    is_blunder: bool
    feature_vector: list[float]
    cluster_id: Optional[str] = None
    phase: Literal["opening", "middlegame", "endgame"]
    clustered_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)

    model_config = {"populate_by_name": True}


# Models weakness cluster generated from mistake clustering
class WeaknessCluster(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    user_id: str
    cluster_id: str
    centroid_normalized: list[float]
    centroid_raw: list[float]
    representative_fens: list[str]
    human_label: str
    display_name: str
    feature_summary: dict
    mistake_count: int
    mistake_count_since_report: int = 0
    mistake_rate_trend: str = "stable"
    last_reported_at: Optional[datetime] = None
    last_clustered_at: Optional[datetime] = None
    first_seen_at: Optional[datetime] = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=utcnow)

    model_config = {"populate_by_name": True}


# Models SRS drill card tracking mastery over time
class SRSRecord(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    user_id: str
    cluster_id: str
    fen: str
    best_move: str
    alternative_moves: list[str] = Field(default_factory=list)
    explanation: str = ""
    easiness_factor: float = 2.5
    interval_days: int = 1
    repetition_count: int = 0
    next_review_at: datetime = Field(default_factory=utcnow)
    last_reviewed_at: Optional[datetime] = None
    quality_history: list[dict] = Field(default_factory=list)
    position_difficulty: float = 1.0
    elo_at_creation: int = 1200
    created_at: datetime = Field(default_factory=utcnow)

    model_config = {"populate_by_name": True}


# Models AI agent diagnostic report for weakness cluster
class WeaknessReport(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    user_id: str
    cluster_id: str
    generated_at: datetime = Field(default_factory=utcnow)
    pattern_name: str
    root_cause: str
    signals: list[str] = Field(default_factory=list)
    drill_guidance: str
    mistake_count_at_generation: int
    player_elo_at_generation: int
    representative_positions: list[str] = Field(default_factory=list)
    is_active: bool = True
    acknowledged_by_user: bool = False
    dismissed_at: Optional[datetime] = None

    model_config = {"populate_by_name": True}


# Models completed drill practice session record
class DrillSession(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    user_id: str
    session_date: datetime = Field(default_factory=utcnow)
    positions_drilled: list[dict] = Field(default_factory=list)
    clusters_covered: list[str] = Field(default_factory=list)
    total_correct: int = 0
    total_attempted: int = 0
    session_duration_seconds: int = 0

    model_config = {"populate_by_name": True}


# Models user curriculum state tracking triggers
class CurriculumState(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    user_id: str
    last_clustered_at: Optional[datetime] = None
    pending_cluster_run: bool = False
    total_mistakes_logged: int = 0
    total_drills_completed: int = 0
    games_since_last_cluster: int = 0
    updated_at: datetime = Field(default_factory=utcnow)

    model_config = {"populate_by_name": True}


# Models drill answer submission request payload
class DrillSubmitRequest(BaseModel):
    move_played: str
    time_taken_seconds: int = Field(ge=0)
    quality_score: Optional[int] = Field(None, ge=0, le=5)


# Models drill answer submission response payload
class DrillSubmitResponse(BaseModel):
    correct: bool
    best_move: str
    next_interval_days: int
    explanation: str
    signals: list[str] = Field(default_factory=list)


# Models cluster representation with calculated health and status
class ClusterWithHealth(BaseModel):
    cluster_id: str
    human_label: str
    display_name: str
    mistake_count: int
    health: float
    stage: str
    pending_drills_count: int
    last_seen: Optional[datetime] = None
    feature_summary: dict = Field(default_factory=dict)
    latest_report: Optional[dict] = None


# Models user curriculum profile response
class CurriculumProfile(BaseModel):
    clusters: list[ClusterWithHealth] = Field(default_factory=list)
    pending_drills: int = 0
    unread_reports: int = 0
