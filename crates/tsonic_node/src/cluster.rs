use std::collections::BTreeMap;
use std::process::Command;

use crate::error::{NodeError, NodeResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClusterSettings {
    pub exec: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Worker {
    pub id: u32,
    pub process_id: u32,
}

pub fn is_primary() -> bool {
    std::env::var("TSONIC_CLUSTER_WORKER_ID").is_err()
}

pub fn is_worker() -> bool {
    !is_primary()
}

pub fn worker_id() -> Option<u32> {
    std::env::var("TSONIC_CLUSTER_WORKER_ID")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
}

pub fn setup_primary(exec: impl Into<String>, args: &[&str]) -> ClusterSettings {
    ClusterSettings {
        exec: exec.into(),
        args: args.iter().map(|value| value.to_string()).collect(),
    }
}

pub fn fork(
    settings: &ClusterSettings,
    id: u32,
    env: &BTreeMap<String, String>,
) -> NodeResult<Worker> {
    let mut command = Command::new(&settings.exec);
    command.args(&settings.args);
    for (name, value) in env {
        command.env(name, value);
    }
    command.env("TSONIC_CLUSTER_WORKER_ID", id.to_string());
    let child = command
        .spawn()
        .map_err(|error| NodeError::new("ERR_CLUSTER_WORKER_SPAWN_FAILED", error.to_string()))?;
    Ok(Worker {
        id,
        process_id: child.id(),
    })
}
