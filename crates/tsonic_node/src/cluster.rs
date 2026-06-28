use std::collections::BTreeMap;
use std::process::Command;

use crate::error::{NodeError, NodeResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClusterSettings {
    pub exec: String,
    pub args: Vec<String>,
    pub exec_argv: Vec<String>,
    pub cwd: Option<String>,
    pub serialization: Option<String>,
    pub silent: bool,
    pub stdio: Vec<String>,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
    pub inspect_port: Option<u16>,
    pub windows_hide: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Worker {
    pub id: u32,
    pub process_id: u32,
    pub state: String,
    pub exited_after_disconnect: bool,
    connected: bool,
    dead: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerOptions {
    pub id: Option<u32>,
    pub state: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Address {
    pub address: String,
    pub port: u16,
    pub address_type: AddressType,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AddressType {
    Ipv4,
    Ipv6,
    Udp4,
    Udp6,
    Unix,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cluster {
    settings: ClusterSettings,
    workers: BTreeMap<u32, Worker>,
    scheduling_policy: i32,
}

pub const SCHED_NONE: i32 = 1;
pub const SCHED_RR: i32 = 2;

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
        exec_argv: Vec::new(),
        cwd: None,
        serialization: Some("json".to_string()),
        silent: false,
        stdio: Vec::new(),
        uid: None,
        gid: None,
        inspect_port: None,
        windows_hide: false,
    }
}

pub fn setup_master(exec: impl Into<String>, args: &[&str]) -> ClusterSettings {
    setup_primary(exec, args)
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
        state: "online".to_string(),
        exited_after_disconnect: false,
        connected: true,
        dead: false,
    })
}

impl ClusterSettings {
    pub fn with_exec_argv(mut self, exec_argv: &[&str]) -> Self {
        self.exec_argv = exec_argv.iter().map(|value| value.to_string()).collect();
        self
    }

    pub fn with_cwd(mut self, cwd: impl Into<String>) -> Self {
        self.cwd = Some(cwd.into());
        self
    }

    pub fn with_serialization(mut self, serialization: impl Into<String>) -> Self {
        self.serialization = Some(serialization.into());
        self
    }

    pub fn with_silent(mut self, silent: bool) -> Self {
        self.silent = silent;
        self
    }
}

impl Worker {
    pub fn new(options: WorkerOptions, process_id: u32) -> Self {
        Self {
            id: options.id.unwrap_or(0),
            process_id,
            state: options.state.unwrap_or_else(|| "online".to_string()),
            exited_after_disconnect: false,
            connected: true,
            dead: false,
        }
    }

    pub fn is_connected(&self) -> bool {
        self.connected && !self.dead
    }

    pub fn is_dead(&self) -> bool {
        self.dead
    }

    pub fn disconnect(&mut self) -> &mut Self {
        self.connected = false;
        self.exited_after_disconnect = true;
        self.state = "disconnected".to_string();
        self
    }

    pub fn kill(&mut self, _signal: Option<&str>) {
        self.connected = false;
        self.dead = true;
        self.state = "dead".to_string();
    }

    pub fn destroy(&mut self, signal: Option<&str>) {
        self.kill(signal);
    }

    pub fn send(&self, _message: &str) -> bool {
        self.is_connected()
    }
}

impl Cluster {
    pub fn new(settings: ClusterSettings) -> Self {
        Self {
            settings,
            workers: BTreeMap::new(),
            scheduling_policy: SCHED_RR,
        }
    }

    pub fn settings(&self) -> &ClusterSettings {
        &self.settings
    }

    pub fn workers(&self) -> &BTreeMap<u32, Worker> {
        &self.workers
    }

    pub fn scheduling_policy(&self) -> i32 {
        self.scheduling_policy
    }

    pub fn set_scheduling_policy(&mut self, scheduling_policy: i32) {
        self.scheduling_policy = scheduling_policy;
    }

    pub fn is_primary(&self) -> bool {
        is_primary()
    }

    pub fn is_master(&self) -> bool {
        self.is_primary()
    }

    pub fn is_worker(&self) -> bool {
        is_worker()
    }

    pub fn setup_primary(&mut self, settings: ClusterSettings) {
        self.settings = settings;
    }

    pub fn setup_master(&mut self, settings: ClusterSettings) {
        self.setup_primary(settings);
    }

    pub fn fork(&mut self, id: u32, env: &BTreeMap<String, String>) -> NodeResult<Worker> {
        let worker = fork(&self.settings, id, env)?;
        self.workers.insert(id, worker.clone());
        Ok(worker)
    }

    pub fn disconnect(&mut self, callback: Option<impl FnOnce()>) {
        for worker in self.workers.values_mut() {
            worker.disconnect();
        }
        if let Some(callback) = callback {
            callback();
        }
    }
}
