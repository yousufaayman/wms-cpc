from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from .core.config import settings
from urllib.parse import quote_plus
from . import models

# The schema (database, schemas, enums, tables) is owned by the cpc-db repo
# (Atlas). This app only reads and writes data; it never creates objects.

# URL encode the password to handle special characters
password = quote_plus(settings.POSTGRES_PASSWORD)

# Connections are lazy until first use
SQLALCHEMY_DATABASE_URL = f"postgresql+psycopg2://{settings.POSTGRES_USER}:{password}@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{settings.POSTGRES_DATABASE}"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=3600
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Canonical declarative base is owned by backend.models.
Base = models.Base

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()