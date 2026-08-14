from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .database import Base, engine, ensure_database, sync_schema
from .routers import auth, content, logistics, orders, payments, products, uploads

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="蜂蜜商城 API",
    description="蜂蜜／團購／新聞報導／品牌故事，含會員與工作人員後台",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

app.include_router(auth.router)
app.include_router(products.router)
app.include_router(content.router)
app.include_router(orders.router)
app.include_router(uploads.router)
app.include_router(logistics.router)
app.include_router(payments.router)


@app.on_event("startup")
def on_startup() -> None:
    ensure_database()
    Base.metadata.create_all(bind=engine)
    sync_schema()


@app.get("/api/health")
def health():
    return {"status": "ok"}
