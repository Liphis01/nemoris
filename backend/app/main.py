from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .bootstrap import init_database
from .config import FRONTEND_DIST_DIR, STATIC_DIR
from .routers import collections, groups, maps, questions, review, uploads


def create_app():
    init_database()

    app = FastAPI()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    STATIC_DIR.mkdir(exist_ok=True)
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    app.include_router(questions.router)
    app.include_router(groups.router)
    app.include_router(collections.router)
    app.include_router(review.router)
    app.include_router(maps.router)
    app.include_router(uploads.router)

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

            if frontend_file.is_file():
                return FileResponse(frontend_file)

            return FileResponse(FRONTEND_DIST_DIR / "index.html")

    return app


app = create_app()
