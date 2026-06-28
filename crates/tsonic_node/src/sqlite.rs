use std::collections::BTreeMap;

use rusqlite::types::ValueRef;
use rusqlite::{Connection, ToSql};
use tsonic_js::value::JsValue;

use crate::error::{NodeError, NodeResult};

#[derive(Debug)]
pub struct DatabaseSync {
    connection: Connection,
}

impl DatabaseSync {
    pub fn open(path: &str) -> NodeResult<Self> {
        let connection = if path == ":memory:" {
            Connection::open_in_memory()
        } else {
            Connection::open(path)
        }
        .map_err(map_sqlite_error)?;
        Ok(Self { connection })
    }

    pub fn exec(&self, sql: &str) -> NodeResult<()> {
        self.connection.execute_batch(sql).map_err(map_sqlite_error)
    }

    pub fn run(&self, sql: &str, params: &[SqlValue]) -> NodeResult<RunResult> {
        let params = params.iter().map(SqlValue::as_to_sql).collect::<Vec<_>>();
        let changed = self
            .connection
            .execute(sql, params.as_slice())
            .map_err(map_sqlite_error)?;
        Ok(RunResult {
            changes: changed,
            last_insert_rowid: self.connection.last_insert_rowid(),
        })
    }

    pub fn all(
        &self,
        sql: &str,
        params: &[SqlValue],
    ) -> NodeResult<Vec<BTreeMap<String, JsValue>>> {
        let params = params.iter().map(SqlValue::as_to_sql).collect::<Vec<_>>();
        let mut statement = self.connection.prepare(sql).map_err(map_sqlite_error)?;
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

    pub fn get(
        &self,
        sql: &str,
        params: &[SqlValue],
    ) -> NodeResult<Option<BTreeMap<String, JsValue>>> {
        Ok(self.all(sql, params)?.into_iter().next())
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
