use std::process::Command;

use crate::error::{NodeError, NodeResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpawnOutput {
    pub status: i32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

impl SpawnOutput {
    pub fn stdout_string(&self) -> NodeResult<String> {
        String::from_utf8(self.stdout.clone())
            .map_err(|error| NodeError::new("ERR_INVALID_ARG_VALUE", error.to_string()))
    }
}

pub fn spawn_file_sync(program: &str, args: &[&str]) -> NodeResult<SpawnOutput> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| NodeError::new("ENOENT", error.to_string()))?;
    Ok(SpawnOutput {
        status: output.status.code().unwrap_or(1),
        stdout: output.stdout,
        stderr: output.stderr,
    })
}
