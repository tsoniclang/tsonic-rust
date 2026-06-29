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
