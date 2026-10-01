"""One-shot database bootstrap, run once before uvicorn starts.

Order matters: database -> wms schema -> ENUM types -> tables. Running this
outside the app import path avoids the create_all/enum race and the duplicate
work across uvicorn workers.
"""
from . import models
from .database import engine
from .startup import initialize_application


def main() -> None:
    initialize_application()
    models.Base.metadata.create_all(bind=engine)


if __name__ == "__main__":
    main()
