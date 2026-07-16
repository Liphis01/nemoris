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
    maps,
    media_groups,
    questions,
    review,
    sequence_groups,
    stats,
    tags,
    text_groups,
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
    app.include_router(media_groups.router)
    app.include_router(text_groups.router)
    app.include_router(sequence_groups.router)
    app.include_router(uploads.router)
    app.include_router(backup.router)

    @app.post("/shell/bridge-status")
    def shell_bridge_status(ok: bool):
        # The desktop shell reports whether the pywebview JS bridge appeared
        # in the page. A missing bridge is otherwise invisible (dead title
        # bar buttons, nothing in any log); this line lands in nemoris.log
        # and the release smoke test asserts on it.
        print(f"SHELL BRIDGE ok={ok}", flush=True)
        return {"ok": ok}

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
