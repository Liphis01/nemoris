from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .bootstrap import init_database
from .config import FRONTEND_DIST_DIR, STATIC_DIR
from .routers import (
    backup,
    packs,
    collections,
    groups,
    map_imports,
    maps,
    media_groups,
    meta,
    profile,
    questions,
    review,
    sequence_groups,
    stats,
    sync,
    tags,
    text_groups,
    training,
    uploads
)
from .services.startup import run_startup_rebalance_with_session
from .services.sync_state import (
    mark_collection_changed,
    should_mark_collection_changed
)


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

    @app.middleware("http")
    async def mark_sync_dirty_after_collection_mutation(request, call_next):
        response = await call_next(request)

        if should_mark_collection_changed(
            request.method,
            request.url.path,
            response.status_code
        ):
            mark_collection_changed(f"{request.method} {request.url.path}")

        return response

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
    app.include_router(map_imports.router)
    app.include_router(media_groups.router)
    app.include_router(text_groups.router)
    app.include_router(sequence_groups.router)
    app.include_router(uploads.router)
    app.include_router(backup.router)
    app.include_router(meta.router)
    app.include_router(packs.router)
    app.include_router(profile.router)
    app.include_router(sync.router)

    if FRONTEND_DIST_DIR.exists():
        assets_dir = FRONTEND_DIST_DIR / "assets"

        if assets_dir.exists():
            app.mount(
                "/assets",
                StaticFiles(directory=assets_dir),
                name="frontend-assets"
            )

        # index.html must revalidate on every load: without Cache-Control
        # the webview's heuristic caching can serve a stale document (and
        # therefore an entire stale app bundle) across app updates. The
        # hashed /assets files stay safely cacheable.
        index_headers = {"Cache-Control": "no-cache"}

        @app.get("/")
        def serve_frontend():
            return FileResponse(
                FRONTEND_DIST_DIR / "index.html", headers=index_headers
            )

        @app.get("/{full_path:path}")
        def serve_frontend_route(full_path: str):
            frontend_file = FRONTEND_DIST_DIR / full_path

            # Prefer real files from the Vite build, then fall back to
            # index.html so React can handle client-side routes.
            if frontend_file.is_file():
                return FileResponse(frontend_file)

            return FileResponse(
                FRONTEND_DIST_DIR / "index.html", headers=index_headers
            )

    return app


app = create_app()
