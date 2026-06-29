#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Session {
    db: String,
    table: Option<String>,
    closed: Cell<bool>,
}

impl Session {
    pub fn changeset(&self) -> Vec<u8> {
        Vec::new()
    }

    pub fn patchset(&self) -> Vec<u8> {
        Vec::new()
    }

    pub fn close(&self) {
        self.closed.set(true);
    }

    pub fn db(&self) -> &str {
        &self.db
    }

    pub fn table(&self) -> Option<&str> {
        self.table.as_deref()
    }

    pub fn closed(&self) -> bool {
        self.closed.get()
    }
}

#[derive(Debug)]
pub struct SQLTagStore {
    connection: Rc<Connection>,
    capacity: usize,
    size: Cell<usize>,
}

impl SQLTagStore {
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    pub fn size(&self) -> usize {
        self.size.get()
    }

    pub fn clear(&self) {
        self.size.set(0);
    }

    pub fn run(&self, sql: &str, params: &[SqlValue]) -> NodeResult<RunResult> {
        self.size.set((self.size.get() + 1).min(self.capacity));
        StatementSync {
            connection: Rc::clone(&self.connection),
            sql: sql.to_string(),
            source_sql: sql.to_string(),
            expanded_sql: sql.to_string(),
            read_bigints: Cell::new(false),
            return_arrays: Cell::new(false),
            allow_bare_named_parameters: Cell::new(false),
            allow_unknown_named_parameters: Cell::new(false),
        }
        .run(params)
    }

    pub fn all(
        &self,
        sql: &str,
        params: &[SqlValue],
    ) -> NodeResult<Vec<BTreeMap<String, JsValue>>> {
        self.size.set((self.size.get() + 1).min(self.capacity));
        StatementSync {
            connection: Rc::clone(&self.connection),
            sql: sql.to_string(),
            source_sql: sql.to_string(),
            expanded_sql: sql.to_string(),
            read_bigints: Cell::new(false),
            return_arrays: Cell::new(false),
            allow_bare_named_parameters: Cell::new(false),
            allow_unknown_named_parameters: Cell::new(false),
        }
        .all(params)
    }

    pub fn get(
        &self,
        sql: &str,
        params: &[SqlValue],
    ) -> NodeResult<Option<BTreeMap<String, JsValue>>> {
        Ok(self.all(sql, params)?.into_iter().next())
    }
}

pub struct FunctionOptions {
    pub deterministic: bool,
    pub direct_only: bool,
    pub use_big_int_arguments: bool,
    pub varargs: bool,
}

pub struct AggregateOptions {
    pub start: Option<SqlValue>,
    pub step: fn(SqlValue, &[SqlValue]) -> SqlValue,
    pub inverse: Option<fn(SqlValue, &[SqlValue]) -> SqlValue>,
    pub result: Option<fn(SqlValue) -> SqlValue>,
}

pub mod constants {
    pub const SQLITE_OK: u32 = 0;
    pub const SQLITE_DENY: u32 = 1;
    pub const SQLITE_IGNORE: u32 = 2;
    pub const SQLITE_CREATE_INDEX: u32 = 1;
    pub const SQLITE_CREATE_TABLE: u32 = 2;
    pub const SQLITE_CREATE_TEMP_INDEX: u32 = 3;
    pub const SQLITE_CREATE_TEMP_TABLE: u32 = 4;
    pub const SQLITE_CREATE_TEMP_TRIGGER: u32 = 5;
    pub const SQLITE_CREATE_TEMP_VIEW: u32 = 6;
    pub const SQLITE_CREATE_TRIGGER: u32 = 7;
    pub const SQLITE_CREATE_VIEW: u32 = 8;
    pub const SQLITE_CREATE_VTABLE: u32 = 29;
    pub const SQLITE_DROP_INDEX: u32 = 10;
    pub const SQLITE_DROP_TABLE: u32 = 11;
    pub const SQLITE_DROP_TEMP_INDEX: u32 = 12;
    pub const SQLITE_DROP_TEMP_TABLE: u32 = 13;
    pub const SQLITE_DROP_TEMP_TRIGGER: u32 = 14;
    pub const SQLITE_DROP_TEMP_VIEW: u32 = 15;
    pub const SQLITE_DROP_TRIGGER: u32 = 16;
    pub const SQLITE_DROP_VIEW: u32 = 17;
    pub const SQLITE_DROP_VTABLE: u32 = 30;
    pub const SQLITE_INSERT: u32 = 18;
    pub const SQLITE_DELETE: u32 = 9;
    pub const SQLITE_UPDATE: u32 = 23;
    pub const SQLITE_SELECT: u32 = 21;
    pub const SQLITE_READ: u32 = 20;
    pub const SQLITE_PRAGMA: u32 = 19;
    pub const SQLITE_FUNCTION: u32 = 31;
    pub const SQLITE_TRANSACTION: u32 = 22;
    pub const SQLITE_SAVEPOINT: u32 = 32;
    pub const SQLITE_ATTACH: u32 = 24;
    pub const SQLITE_DETACH: u32 = 25;
    pub const SQLITE_ALTER_TABLE: u32 = 26;
    pub const SQLITE_REINDEX: u32 = 27;
    pub const SQLITE_ANALYZE: u32 = 28;
    pub const SQLITE_COPY: u32 = 0;
    pub const SQLITE_RECURSIVE: u32 = 33;
    pub const SQLITE_CHANGESET_DATA: u32 = 1;
    pub const SQLITE_CHANGESET_NOTFOUND: u32 = 2;
    pub const SQLITE_CHANGESET_CONFLICT: u32 = 3;
    pub const SQLITE_CHANGESET_CONSTRAINT: u32 = 4;
    pub const SQLITE_CHANGESET_FOREIGN_KEY: u32 = 5;
    pub const SQLITE_CHANGESET_OMIT: u32 = 0;
    pub const SQLITE_CHANGESET_REPLACE: u32 = 1;
    pub const SQLITE_CHANGESET_ABORT: u32 = 2;
}

fn sqlite_value(value: ValueRef<'_>) -> JsValue {
    match value {
        ValueRef::Null => JsValue::Null,
        ValueRef::Integer(value) => JsValue::Number(value as f64),
        ValueRef::Real(value) => JsValue::Number(value),
        ValueRef::Text(value) => JsValue::String(String::from_utf8_lossy(value).to_string()),
        ValueRef::Blob(value) => JsValue::from(
            value
                .iter()
                .map(|byte| JsValue::Number(f64::from(*byte)))
                .collect::<Vec<_>>(),
        ),
    }
}

fn map_sqlite_error(error: rusqlite::Error) -> NodeError {
    NodeError::new("ERR_SQLITE_ERROR", error.to_string())
}
