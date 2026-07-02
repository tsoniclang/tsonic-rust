//! Fake async provider crate proving async provider-package rows.

pub struct Db {
    statements: i32,
}

pub async fn connect(path: String) -> Db {
    let _ = path;
    Db { statements: 0 }
}

impl Db {
    pub async fn execute(&mut self, sql: String) -> i32 {
        let _ = sql;
        self.statements += 1;
        self.statements
    }
}
