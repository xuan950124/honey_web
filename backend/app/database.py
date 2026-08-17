import logging

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

log = logging.getLogger(__name__)

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


def should_widen(db_column: dict, model_column, indexed_names: set[str] | None = None) -> bool:
    """資料庫這一欄比模型要求的窄嗎？

    只回答「該不該加寬」。縮小永遠回 False —— 縮小會截斷既有資料，
    那是不可逆的，寧可資料庫比程式寬鬆。

    `indexed_names` 是**資料庫實際上**有索引的欄位名稱。
    為什麼不能只看模型宣告：MySQL 不允許把有索引的欄位改成 TEXT
    （會報 "BLOB/TEXT column used in key specification without a key length"），
    而資料庫裡可能存在模型沒宣告的索引（早期手動加的、或外鍵自動建的）。
    只看模型會漏掉那些，ALTER 就會失敗。
    """
    if model_column.primary_key or model_column.unique or model_column.index:
        return False
    if indexed_names and model_column.name in indexed_names:
        return False
    have = _current_width(db_column)
    want = _target_width(model_column)
    if have is None or want is None:
        return False
    return want > have


def indexed_columns(inspector, table_name: str) -> set[str]:
    """問資料庫：這張表哪些欄位被索引到了（含主鍵與唯一鍵）。"""
    names: set[str] = set()
    try:
        for idx in inspector.get_indexes(table_name):
            names.update(c for c in (idx.get("column_names") or []) if c)
    except Exception:  # noqa: BLE001 - 讀不到索引就當作全部都有索引，寧可不改
        return {"*"}
    try:
        pk = inspector.get_pk_constraint(table_name) or {}
        names.update(pk.get("constrained_columns") or [])
    except Exception:  # noqa: BLE001
        pass
    try:
        for fk in inspector.get_foreign_keys(table_name):
            names.update(fk.get("constrained_columns") or [])
    except Exception:  # noqa: BLE001
        pass
    return names


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

    **每一句 ALTER 都各自獨立執行、各自防護。** 這一點是踩過坑才改的：
    原本整批包在一個交易裡，只要有一句失敗就整個往上拋，
    startup 事件掛掉、uvicorn 起不來、整個網站 502 ——
    而使用者在瀏覽器看到的是「已被 CORS 政策封鎖」，
    完全看不出來是資料表調整失敗。
    調欄位寬度這種小事，絕對不該有能力讓整站下線。
    """
    from sqlalchemy import inspect

    # inspect() 自己就會連線，連不上時會在這裡就丟例外，所以要一起包進來
    try:
        inspector = inspect(engine)
        existing_tables = set(inspector.get_table_names())
    except Exception as exc:  # noqa: BLE001
        log.warning("[資料表更新] 讀不到現有資料表，略過這次同步：%s", exc)
        return

    statements: list[tuple[str, str]] = []   # (說明, SQL)

    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue  # 新表交給 create_all 處理

        try:
            db_cols = {c["name"]: c for c in inspector.get_columns(table.name)}
        except Exception:  # noqa: BLE001
            log.exception("[資料表更新] 讀不到 %s 的欄位，略過這張表", table.name)
            continue

        indexed = indexed_columns(inspector, table.name)

        for column in table.columns:
            # ---------- 1. 缺少的欄位 ----------
            if column.name not in db_cols:
                statements.append((
                    f"{table.name} 新增欄位 {column.name}",
                    _add_column_sql(table.name, column, engine.dialect),
                ))
                continue

            # ---------- 2. 太窄的字串欄位 ----------
            if not should_widen(db_cols[column.name], column, indexed):
                continue

            # SQLite 不支援 MODIFY COLUMN，但它本來也不檢查長度，跳過沒差
            if engine.dialect.name == "sqlite":
                continue

            statements.append((
                f"{table.name}.{column.name} 加寬為 "
                f"{column.type.compile(dialect=engine.dialect)}",
                _widen_sql(table.name, column, engine.dialect),
            ))

    if not statements:
        return

    done = failed = 0
    for description, sql in statements:
        # 一句一個交易。MySQL 的 DDL 本來就不能回滾，
        # 包在一起只會讓「前面成功、中間失敗」變得更難收拾。
        try:
            with engine.begin() as conn:
                conn.execute(text(sql))
            done += 1
            print(f"[資料表更新] {description}")
        except Exception as exc:  # noqa: BLE001 - 單句失敗不能中斷其他句，更不能讓網站起不來
            failed += 1
            log.warning("[資料表更新] 失敗：%s\n  SQL: %s\n  原因: %s", description, sql, exc)

    print(f"[資料表更新] 完成 {done} 項"
          + (f"，失敗 {failed} 項（詳見上方日誌，網站仍可正常啟動）" if failed else ""))
