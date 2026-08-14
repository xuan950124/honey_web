from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_recycle=3600,
    echo=False,
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    pass


def ensure_database() -> None:
    """若 MySQL 中還沒有這個 database，先建立它。"""
    tmp_engine = create_engine(settings.server_url, pool_pre_ping=True)
    with tmp_engine.connect() as conn:
        conn.execute(
            text(
                f"CREATE DATABASE IF NOT EXISTS `{settings.DB_NAME}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
        )
        conn.commit()
    tmp_engine.dispose()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def sync_schema() -> None:
    """把資料表補齊到與程式模型一致（只新增欄位，不會刪除或改動既有資料）。

    這個專案沒有導入 Alembic 這類正式的 migration 工具，
    而 SQLAlchemy 的 create_all() 只會建立「不存在的表」，
    已存在的表新增欄位時不會自動處理。
    這裡用最保守的方式：比對模型與實際資料表，只對缺少的欄位下 ALTER TABLE ADD COLUMN。
    """
    from sqlalchemy import inspect

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue  # 新表交給 create_all 處理

            existing_cols = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing_cols:
                    continue

                col_type = column.type.compile(dialect=engine.dialect)
                clause = f"ADD COLUMN `{column.name}` {col_type}"

                default = column.default
                if default is not None and getattr(default, "is_scalar", False):
                    value = default.arg
                    if isinstance(value, bool):
                        clause += f" NOT NULL DEFAULT {1 if value else 0}"
                    elif isinstance(value, (int, float)):
                        clause += f" NOT NULL DEFAULT {value}"
                    else:
                        literal = str(getattr(value, "value", value)).replace("'", "''")
                        clause += f" NOT NULL DEFAULT '{literal}'"
                elif not column.nullable:
                    clause += " NULL"  # 既有資料列沒有值，只能先放寬為可空

                conn.execute(text(f"ALTER TABLE `{table.name}` {clause}"))
                print(f"[資料表更新] {table.name} 新增欄位 {column.name}")
