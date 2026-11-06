"""GET /api/v1/features: which optional modules are switched on.

The flags come from settings (FEATURE_ACCESSORIES, FEATURE_NEEDLES in .env).
The frontend reads this once after login (hooks/useFeatures.ts) to decide
whether to show accessory and needle screens. It returns the same answer for
every logged-in user; permissions are a separate check.
"""
from fastapi import APIRouter
from pydantic import BaseModel

from backend.core.config import settings

router = APIRouter()


class Features(BaseModel):
    accessories: bool
    needles: bool


@router.get("/", response_model=Features)
def read_features() -> Features:
    return Features(**settings.features_enabled())
