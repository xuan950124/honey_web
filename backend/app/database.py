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
    """若 MySQL 中還沒有這個 database，先建立它。

    託管型的資料庫服務（Zeabur、各家雲端 RDS）通常已經幫你開好 database，
    而且給的帳號**沒有** CREATE DATABASE 權限，這時建立會失敗。
    只要目標 database 本身連得上，就當作沒問題繼續往下跑。
    """
    try:
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
    except Exception as exc:  # noqa: BLE001
        # 連得到目標 database 就沒事；連不到才是真的有問題，讓原始錯誤往上拋
        try:
            engine.connect().close()
            print(f"[資料庫] 略過建立 database（{type(exc).__name__}），"
                  f"已直接連上 {settings.DB_NAME}")
        except Exception:
            raise exc from None


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def _current_width(col: dict) -> int | None:
    """讀出資料庫裡這個欄位目前能存幾個字元。不是字串型別就回 None。

    TEXT / LONGTEXT 這類沒有 length，SQLAlchemy 會給 None，
    這裡回一個很大的數字代表「已經夠寬了」。
    """
    col_type = col.get("type")
    type_name = type(col_type).__name__.upper()
    if "TEXT" in type_name:
        return 10 ** 9
    length = getattr(col_type, "length", None)
    if length is None:
        return None
    return int(length)


def _target_width(column) -> int | None:
    """模型希望這個欄位能存幾個字元。"""
    type_name = type(column.type).__name__.upper()
    if "TEXT" in type_name:
        return 10 ** 9
    length = getattr(column.type, "length", None)
    if length is None:
        return None
    return int(length)


def _add_column_sql(table_name: str, column, dialect) -> str:
    """組出「新增欄位」的 ALTER TABLE。抽出來是為了能單獨測。"""
    col_type = column.type.compile(dialect=dialect)
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

    return f"ALTER TABLE `{table_name}` {clause}"


def _widen_sql(table_name: str, column, dialect) -> str:
    """組出「加寬欄位」的 ALTER TABLE。"""
    col_type = column.type.compile(dialect=dialect)
    null_clause = "NULL" if column.nullable else "NOT NULL"
    return f"ALTER TABLE `{table_name}` MODIFY `{column.name}` {col_type} {null_clause}"


def should_widen(db_column: dict, model_column) -> bool:
    """資料庫這一欄比模型要求的窄嗎？

    只回答「該不該加寬」。縮小永遠回 False —— 縮小會截斷既有資料，
    那是不可逆的，寧可資料庫比程式寬鬆。
    """
    if model_column.primary_key or model_column.unique or model_column.index:
        # 有索引的欄位改成 TEXT 會讓 MySQL 抱怨索引長度，別動
        return False
    have = _current_width(db_column)
    want = _target_width(model_column)
    if have is None or want is None:
        return False
    return want > have


def sync_schema() -> None:
    """把資料表補齊到與程式模型一致。

    這個專案沒有導入 Alembic 這類正式的 migration 工具，
    而 SQLAlchemy 的 create_all() 只會建立「不存在的表」，
    已存在的表不會自動處理。這裡做兩件事，兩件都不會弄丟資料：

      1. 缺少的欄位 -> ALTER TABLE ADD COLUMN
      2. 太窄的字串欄位 -> ALTER TABLE MODIFY 加寬

    第 2 項是後來加的。起因是 news.source_url 原本設 VARCHAR(400)，
    但 Facebook 貼文的網址會把整篇標題做 URL 編碼塞進路徑（一個中文字 9 個字元），
    實測 753 個字元，MySQL 直接拒絕寫入，前台只看到 500 錯誤。

    **只加寬，永遠不縮小。** 縮小會截斷既有資料，那是不可逆的，
    所以就算模型改小了也不動 —— 寧可資料庫比程式寬鬆。
    """
    from sqlalchemy import inspect

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue  # 新表交給 create_all 處理

            db_cols = {c["name"]: c for c in inspector.get_columns(table.name)}

            for column in table.columns:
                # ---------- 1. 缺少的欄位 ----------
                if column.name not in db_cols:
                    conn.execute(text(_add_column_sql(table.name, column, engine.dialect)))
                    print(f"[資料表更新] {table.name} 新增欄位 {column.name}")
                    continue

                # ---------- 2. 太窄的字串欄位 ----------
                if not should_widen(db_cols[column.name], column):
                    continue

                # SQLite 不支援 MODIFY COLUMN，但它本來就不檢查長度，跳過沒差
                if engine.dialect.name == "sqlite":
                    continue

                conn.execute(text(_widen_sql(table.name, column, engine.dialect)))
                print(f"[資料表更新] {table.name}.{column.name} 加寬為 "
                      f"{column.type.compile(dialect=engine.dialect)}")
