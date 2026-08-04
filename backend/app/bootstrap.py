from .migrations import run_migrations


def init_database():
    # No first-run content is shipped: a fresh install starts on an empty
    # collection and users fill it from the pack catalogue or their own
    # imports. run_migrations creates the schema when the file is missing.
    return run_migrations()
