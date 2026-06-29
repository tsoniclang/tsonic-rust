use std::cell::Cell;
use std::collections::BTreeMap;
use std::rc::Rc;

use rusqlite::types::ValueRef;
use rusqlite::{Connection, ToSql};
use tsonic_js::value::JsValue;

use crate::error::{NodeError, NodeResult};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DatabaseLimits {
    pub length: u32,
    pub sql_length: u32,
    pub column: u32,
    pub expr_depth: u32,
    pub compound_select: u32,
    pub vdbe_op: u32,
    pub function_arg: u32,
    pub attach: u32,
    pub like_pattern_length: u32,
    pub variable_number: u32,
    pub trigger_depth: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DatabaseSyncOptions {
    pub open: bool,
    pub read_only: bool,
    pub enable_foreign_key_constraints: bool,
    pub enable_double_quoted_string_literals: bool,
    pub allow_extension: bool,
    pub timeout: Option<u64>,
    pub read_bigints: bool,
    pub return_arrays: bool,
    pub allow_bare_named_parameters: bool,
    pub allow_unknown_named_parameters: bool,
    pub defensive: bool,
    pub limits: Option<DatabaseLimits>,
}

#[derive(Debug)]
pub struct DatabaseSync {
    connection: Rc<Connection>,
    path: String,
    is_open: Cell<bool>,
    read_bigints: Cell<bool>,
    return_arrays: Cell<bool>,
    allow_bare_named_parameters: Cell<bool>,
    allow_unknown_named_parameters: Cell<bool>,
    defensive: Cell<bool>,
    allow_extension: Cell<bool>,
    limits: DatabaseLimits,
}

impl DatabaseSync {
    pub fn open(path: &str) -> NodeResult<Self> {
        Self::open_with_options(path, DatabaseSyncOptions::default())
    }

    pub fn open_with_options(path: &str, options: DatabaseSyncOptions) -> NodeResult<Self> {
        let connection = if path == ":memory:" {
            Connection::open_in_memory()
        } else if options.read_only {
            Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        } else {
            Connection::open(path)
        }
        .map_err(map_sqlite_error)?;
        if let Some(timeout) = options.timeout {
            connection
                .busy_timeout(std::time::Duration::from_millis(timeout))
                .map_err(map_sqlite_error)?;
        }
        Ok(Self {
            connection: Rc::new(connection),
            path: path.to_string(),
            is_open: Cell::new(options.open || !path.is_empty()),
            read_bigints: Cell::new(options.read_bigints),
            return_arrays: Cell::new(options.return_arrays),
            allow_bare_named_parameters: Cell::new(options.allow_bare_named_parameters),
            allow_unknown_named_parameters: Cell::new(options.allow_unknown_named_parameters),
            defensive: Cell::new(options.defensive),
            allow_extension: Cell::new(options.allow_extension),
            limits: options.limits.unwrap_or_default(),
        })
    }

    pub fn is_open(&self) -> bool {
        self.is_open.get()
    }

    pub fn is_transaction(&self) -> bool {
        !self.connection.is_autocommit()
    }

    pub fn limits(&self) -> &DatabaseLimits {
        &self.limits
    }

    pub fn close(&self) {
        self.is_open.set(false);
    }

    pub fn open_connection(&self) {
        self.is_open.set(true);
    }

    pub fn location(&self, db_name: Option<&str>) -> Option<String> {
        if db_name.is_some_and(|name| name != "main") {
            return None;
        }
        Some(self.path.clone())
    }

    pub fn exec(&self, sql: &str) -> NodeResult<()> {
        self.ensure_open()?;
        self.connection.execute_batch(sql).map_err(map_sqlite_error)
    }

    pub fn prepare(&self, sql: &str, options: Option<PrepareOptions>) -> StatementSync {
        let options = options.unwrap_or_default();
        StatementSync {
            connection: Rc::clone(&self.connection),
            sql: sql.to_string(),
            source_sql: sql.to_string(),
            expanded_sql: sql.to_string(),
            read_bigints: Cell::new(options.read_bigints || self.read_bigints.get()),
            return_arrays: Cell::new(options.return_arrays || self.return_arrays.get()),
            allow_bare_named_parameters: Cell::new(
                options.allow_bare_named_parameters || self.allow_bare_named_parameters.get(),
            ),
            allow_unknown_named_parameters: Cell::new(
                options.allow_unknown_named_parameters || self.allow_unknown_named_parameters.get(),
            ),
        }
    }

    pub fn run(&self, sql: &str, params: &[SqlValue]) -> NodeResult<RunResult> {
        self.prepare(sql, None).run(params)
    }

    pub fn all(
        &self,
        sql: &str,
        params: &[SqlValue],
    ) -> NodeResult<Vec<BTreeMap<String, JsValue>>> {
        self.prepare(sql, None).all(params)
    }

    pub fn get(
        &self,
        sql: &str,
        params: &[SqlValue],
    ) -> NodeResult<Option<BTreeMap<String, JsValue>>> {
        self.prepare(sql, None).get(params)
    }

    pub fn create_tag_store(&self, max_size: Option<usize>) -> SQLTagStore {
        SQLTagStore {
            connection: Rc::clone(&self.connection),
            capacity: max_size.unwrap_or(1_000),
            size: Cell::new(0),
        }
    }

    pub fn create_session(&self, options: Option<CreateSessionOptions>) -> Session {
        Session {
            db: options
                .as_ref()
                .and_then(|options| options.db.clone())
                .unwrap_or_else(|| "main".to_string()),
            table: options.and_then(|options| options.table),
            closed: Cell::new(false),
        }
    }

    pub fn apply_changeset(
        &self,
        _changeset: &[u8],
        options: Option<ApplyChangesetOptions>,
    ) -> bool {
        options
            .and_then(|options| options.filter)
            .is_none_or(|filter| filter("main"))
    }

    pub fn enable_load_extension(&self, allow: bool) {
        self.allow_extension.set(allow);
    }

    pub fn load_extension(&self, _path: &str) -> NodeResult<()> {
        if self.allow_extension.get() {
            Err(NodeError::new(
                "ERR_SQLITE_EXTENSION_DISABLED",
                "native SQLite extensions are excluded from the closed Rust runtime",
            ))
        } else {
            Err(NodeError::new(
                "ERR_SQLITE_EXTENSION_DISABLED",
                "SQLite extension loading is disabled",
            ))
        }
    }

    pub fn enable_defensive(&self, active: bool) {
        self.defensive.set(active);
    }

    pub fn function(&self, _name: &str, _function: fn(&[SqlValue]) -> SqlValue) {}

    pub fn aggregate(&self, _name: &str, _options: AggregateOptions) {}

    fn ensure_open(&self) -> NodeResult<()> {
        if self.is_open.get() {
            Ok(())
        } else {
            Err(NodeError::new("ERR_SQLITE_CLOSED", "database is closed"))
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PrepareOptions {
    pub allow_bare_named_parameters: bool,
    pub allow_unknown_named_parameters: bool,
    pub return_arrays: bool,
    pub read_bigints: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatementColumnMetadata {
    pub name: String,
    pub column: Option<String>,
    pub table: Option<String>,
    pub database: Option<String>,
    pub r#type: Option<String>,
}

#[derive(Debug)]
pub struct StatementSync {
    connection: Rc<Connection>,
    sql: String,
    source_sql: String,
    expanded_sql: String,
    read_bigints: Cell<bool>,
    return_arrays: Cell<bool>,
    allow_bare_named_parameters: Cell<bool>,
    allow_unknown_named_parameters: Cell<bool>,
}

impl StatementSync {
    pub fn source_sql(&self) -> &str {
        &self.source_sql
    }

    pub fn expanded_sql(&self) -> &str {
        &self.expanded_sql
    }

    pub fn set_read_bigints(&self, enabled: bool) {
        self.read_bigints.set(enabled);
    }

    pub fn set_return_arrays(&self, enabled: bool) {
        self.return_arrays.set(enabled);
    }

    pub fn set_allow_bare_named_parameters(&self, enabled: bool) {
        self.allow_bare_named_parameters.set(enabled);
    }

    pub fn set_allow_unknown_named_parameters(&self, enabled: bool) {
        self.allow_unknown_named_parameters.set(enabled);
    }

    pub fn columns(&self) -> NodeResult<Vec<StatementColumnMetadata>> {
        let statement = self
            .connection
            .prepare(&self.sql)
            .map_err(map_sqlite_error)?;
        Ok(statement
            .column_names()
            .into_iter()
            .map(|name| StatementColumnMetadata {
                name: name.to_string(),
                column: Some(name.to_string()),
                table: None,
                database: None,
                r#type: None,
            })
            .collect())
    }

    pub fn run(&self, params: &[SqlValue]) -> NodeResult<RunResult> {
        let params = params.iter().map(SqlValue::as_to_sql).collect::<Vec<_>>();
        let changed = self
            .connection
            .execute(&self.sql, params.as_slice())
            .map_err(map_sqlite_error)?;
        Ok(RunResult {
            changes: changed,
            last_insert_rowid: self.connection.last_insert_rowid(),
        })
    }

    pub fn all(&self, params: &[SqlValue]) -> NodeResult<Vec<BTreeMap<String, JsValue>>> {
        let params = params.iter().map(SqlValue::as_to_sql).collect::<Vec<_>>();
        let mut statement = self
            .connection
            .prepare(&self.sql)
            .map_err(map_sqlite_error)?;
        let names = statement
            .column_names()
            .into_iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>();
        let rows = statement
            .query_map(params.as_slice(), |row| {
                let mut values = BTreeMap::new();
                for (index, name) in names.iter().enumerate() {
                    values.insert(name.clone(), sqlite_value(row.get_ref(index)?));
                }
                Ok(values)
            })
            .map_err(map_sqlite_error)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(map_sqlite_error)
    }

    pub fn get(&self, params: &[SqlValue]) -> NodeResult<Option<BTreeMap<String, JsValue>>> {
        Ok(self.all(params)?.into_iter().next())
    }

    pub fn iterate(&self, params: &[SqlValue]) -> NodeResult<Vec<BTreeMap<String, JsValue>>> {
        self.all(params)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum SqlValue {
    Null,
    Integer(i64),
    Real(f64),
    Text(String),
    Blob(Vec<u8>),
}

impl SqlValue {
    fn as_to_sql(&self) -> &dyn ToSql {
        match self {
            SqlValue::Null => &rusqlite::types::Null,
            SqlValue::Integer(value) => value,
            SqlValue::Real(value) => value,
            SqlValue::Text(value) => value,
            SqlValue::Blob(value) => value,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunResult {
    pub changes: usize,
    pub last_insert_rowid: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupProgressInfo {
    pub total_pages: usize,
    pub remaining_pages: usize,
}

pub struct BackupOptions {
    pub source: Option<String>,
    pub target: Option<String>,
    pub rate: Option<u32>,
    pub progress: Option<Box<dyn FnMut(BackupProgressInfo)>>,
}

#[derive(Default)]
pub struct ApplyChangesetOptions {
    pub filter: Option<fn(&str) -> bool>,
    pub on_conflict: Option<fn(u32) -> u32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CreateSessionOptions {
    pub db: Option<String>,
    pub table: Option<String>,
}

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
