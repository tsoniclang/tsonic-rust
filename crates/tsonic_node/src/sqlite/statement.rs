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
