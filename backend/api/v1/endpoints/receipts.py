# Legacy receipt endpoint — replaced by vendor_receipts, internal_receipts, external_receipts.
# Kept as an empty router to avoid import errors from any stale references.
from fastapi import APIRouter
router = APIRouter()
