from .migrations import run_migrations


def init_database():
    return run_migrations()
