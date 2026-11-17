# Provides curriculum engine package exports
from curriculum.router import router as curriculum_router, internal_router as curriculum_internal_router

__all__ = ["curriculum_router", "curriculum_internal_router"]
