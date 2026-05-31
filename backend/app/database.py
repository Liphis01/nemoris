from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from .config import DATABASE_FILE


DATABASE_FILE.parent.mkdir(parents=True, exist_ok=True)
DATABASE_URL = f"sqlite:///{DATABASE_FILE.as_posix()}"

# SQLite is used as a local app database. check_same_thread=False lets FastAPI
# requests share the engine safely through SQLAlchemy sessions.
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

# Each request gets its own SessionLocal instance through dependencies.get_db.
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()
