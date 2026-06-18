from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .bootstrap import init_database
from .config import FRONTEND_DIST_DIR, STATIC_DIR
from .routers import (
    backup,
    collections,
    groups,
    image_groups,
    maps,
    questions,
    review,
    stats,
    tags,
    training,
    uploads
)
from .services.startup import run_startup_rebalance_with_session


def create_app():
    # The desktop/dev app starts directly from FastAPI, so pending migrations
    # run during app construction while still remaining explicit.
    init_database()
    run_startup_rebalance_with_session()

    app = FastAPI()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Uploaded media is served from /static. The folder is created lazily so a
    # fresh checkout can run without manual setup.
    STATIC_DIR.mkdir(exist_ok=True)
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    # Routers keep API concerns separated by feature while still sharing the
    # same SQLAlchemy session dependency.
    app.include_router(questions.router)
    app.include_router(groups.router)
    app.include_router(collections.router)
    app.include_router(review.router)
    app.include_router(stats.router)
    app.include_router(tags.router)
    app.include_router(training.router)
    app.include_router(maps.router)
    app.include_router(image_groups.router)
    app.include_router(uploads.router)
    app.include_router(backup.router)

    if FRONTEND_DIST_DIR.exists():
        assets_dir = FRONTEND_DIST_DIR / "assets"

        if assets_dir.exists():
            app.mount(
                "/assets",
                StaticFiles(directory=assets_dir),
                name="frontend-assets"
            )

        @app.get("/")
        def serve_frontend():
            return FileResponse(FRONTEND_DIST_DIR / "index.html")

        @app.get("/{full_path:path}")
        def serve_frontend_route(full_path: str):
            frontend_file = FRONTEND_DIST_DIR / full_path

            # Prefer real files from the Vite build, then fall back to
            # index.html so React can handle client-side routes.
            if frontend_file.is_file():
                return FileResponse(frontend_file)

            return FileResponse(FRONTEND_DIST_DIR / "index.html")

    return app


app = create_app()
