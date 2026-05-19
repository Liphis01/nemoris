from .database import SessionLocal


def get_db():
    # FastAPI dependency that scopes one SQLAlchemy session to one request.
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
