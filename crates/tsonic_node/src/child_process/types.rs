use std::collections::BTreeMap;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child as OsChild, Command};

use crate::error::{NodeError, NodeResult};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SpawnOptions {
    pub cwd: Option<PathBuf>,
    pub env: BTreeMap<String, String>,
    pub argv0: Option<String>,
    pub detached: bool,
    pub input: Option<Vec<u8>>,
    pub stdio: StdioOptions,
    pub encoding: OutputEncoding,
    pub max_buffer: Option<usize>,
    pub timeout_ms: Option<u64>,
    pub kill_signal: Option<String>,
    pub shell: bool,
    pub signal_aborted: bool,
    pub windows_verbatim_arguments: bool,
    pub windows_hide: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum OutputEncoding {
    #[default]
    Buffer,
    Utf8,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Stdio {
    #[default]
    Pipe,
    Ignore,
    Inherit,
    Ipc,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StdioOptions {
    pub stdin: Stdio,
    pub stdout: Stdio,
    pub stderr: Stdio,
}

impl Default for StdioOptions {
    fn default() -> Self {
        Self {
            stdin: Stdio::Pipe,
            stdout: Stdio::Pipe,
            stderr: Stdio::Pipe,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MessagingOptions {
    pub keep_open: bool,
    pub kill_signal: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecException {
    pub cmd: String,
    pub code: Option<i32>,
    pub killed: bool,
    pub signal: Option<String>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpawnSyncReturns {
    pub pid: Option<u32>,
    pub output: Vec<Option<Vec<u8>>>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub status: i32,
    pub signal: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromiseWithChild<T> {
    pub value: T,
    pub child: ChildProcessSnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChildProcessSnapshot {
    pub pid: Option<u32>,
    pub spawnfile: String,
    pub spawnargs: Vec<String>,
    pub connected: bool,
    pub killed: bool,
    pub exit_code: Option<i32>,
    pub signal_code: Option<String>,
}

impl SpawnOptions {
    pub fn with_cwd(mut self, cwd: impl Into<PathBuf>) -> Self {
        self.cwd = Some(cwd.into());
        self
    }

    pub fn with_env(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.env.insert(name.into(), value.into());
        self
    }

    pub fn with_input(mut self, input: impl Into<Vec<u8>>) -> Self {
        self.input = Some(input.into());
        self
    }

    pub fn with_stdio(mut self, stdio: StdioOptions) -> Self {
        self.stdio = stdio;
        self
    }

    pub fn with_encoding(mut self, encoding: OutputEncoding) -> Self {
        self.encoding = encoding;
        self
    }

    pub fn with_max_buffer(mut self, max_buffer: usize) -> Self {
        self.max_buffer = Some(max_buffer);
        self
    }

    pub fn with_timeout_ms(mut self, timeout_ms: u64) -> Self {
        self.timeout_ms = Some(timeout_ms);
        self
    }

    pub fn with_kill_signal(mut self, kill_signal: impl Into<String>) -> Self {
        self.kill_signal = Some(kill_signal.into());
        self
    }

    pub fn with_argv0(mut self, argv0: impl Into<String>) -> Self {
        self.argv0 = Some(argv0.into());
        self
    }

    pub fn with_abort_signal(mut self, signal_aborted: bool) -> Self {
        self.signal_aborted = signal_aborted;
        self
    }
}

impl StdioOptions {
    pub fn all(stdio: Stdio) -> Self {
        Self {
            stdin: stdio,
            stdout: stdio,
            stderr: stdio,
        }
    }

    pub fn tuple(stdin: Stdio, stdout: Stdio, stderr: Stdio) -> Self {
        Self {
            stdin,
            stdout,
            stderr,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpawnOutput {
    pub pid: Option<u32>,
    pub status: i32,
    pub signal: Option<String>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub error: Option<String>,
}

impl SpawnOutput {
    pub fn output(&self) -> Vec<Option<Vec<u8>>> {
        vec![None, Some(self.stdout.clone()), Some(self.stderr.clone())]
    }

    pub fn to_spawn_sync_returns(&self) -> SpawnSyncReturns {
        SpawnSyncReturns {
            pid: self.pid,
            output: self.output(),
            stdout: self.stdout.clone(),
            stderr: self.stderr.clone(),
            status: self.status,
            signal: self.signal.clone(),
            error: self.error.clone(),
        }
    }

    pub fn stdout_string(&self) -> NodeResult<String> {
        String::from_utf8(self.stdout.clone())
            .map_err(|error| NodeError::new("ERR_INVALID_ARG_VALUE", error.to_string()))
    }

    pub fn stderr_string(&self) -> NodeResult<String> {
        String::from_utf8(self.stderr.clone())
            .map_err(|error| NodeError::new("ERR_INVALID_ARG_VALUE", error.to_string()))
    }

    pub fn success(&self) -> bool {
        self.status == 0
    }
}
