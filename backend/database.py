from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from .core.config import settings
from urllib.parse import quote_plus
import pymysql

# Register PyMySQL as the MySQL driver
pymysql.install_as_MySQLdb()

# URL encode the password to handle special characters
password = quote_plus(settings.MYSQL_PASSWORD)

def create_database_if_not_exists() -> None:
    initial_engine = create_engine(
        f"mysql+pymysql://{settings.MYSQL_USER}:{password}@{settings.MYSQL_HOST}:{settings.MYSQL_PORT}",
        pool_pre_ping=True,
        pool_recycle=3600,
        connect_args={"charset": "utf8mb4"}
    )
    with initial_engine.connect() as conn:
        conn.execute(text(f"CREATE DATABASE IF NOT EXISTS {settings.MYSQL_DATABASE}"))
        conn.commit()

# Now create engine with database name (connections are lazy until first use)
SQLALCHEMY_DATABASE_URL = f"mysql+pymysql://{settings.MYSQL_USER}:{password}@{settings.MYSQL_HOST}:{settings.MYSQL_PORT}/{settings.MYSQL_DATABASE}"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=3600,
    connect_args={"charset": "utf8mb4"}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()