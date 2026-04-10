from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from .core.config import settings
from urllib.parse import quote_plus
from . import models

# URL encode the password to handle special characters
password = quote_plus(settings.POSTGRES_PASSWORD)

def create_database_if_not_exists() -> None:
    # Connect to PostgreSQL server (not specific database)
    initial_engine = create_engine(
        f"postgresql://{settings.POSTGRES_USER}:{password}@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/postgres",
        pool_pre_ping=True,
        pool_recycle=3600
    )
    with initial_engine.connect() as conn:
        # PostgreSQL equivalent of CREATE DATABASE IF NOT EXISTS
        conn.execute(text("COMMIT"))  # End any existing transaction
        # Check if database exists first
        result = conn.execute(text("SELECT 1 FROM pg_database WHERE datname = :db_name"), {"db_name": settings.POSTGRES_DATABASE})
        if not result.fetchone():
            conn.execute(text(f"CREATE DATABASE {settings.POSTGRES_DATABASE}"))
        conn.commit()

# Now create engine with database name (connections are lazy until first use)
SQLALCHEMY_DATABASE_URL = f"postgresql://{settings.POSTGRES_USER}:{password}@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{settings.POSTGRES_DATABASE}"
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