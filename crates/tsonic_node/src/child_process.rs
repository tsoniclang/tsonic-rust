use std::collections::BTreeMap;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child as OsChild, Command, Stdio};

use crate::error::{NodeError, NodeResult};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SpawnOptions {
    pub cwd: Option<PathBuf>,
    pub env: BTreeMap<String, String>,
    pub detached: bool,
    pub input: Option<Vec<u8>>,
    pub timeout_ms: Option<u64>,
    pub kill_signal: Option<String>,
    pub shell: bool,
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

#[derive(Debug)]
pub struct ChildProcess {
    child: Option<OsChild>,
    pub pid: Option<u32>,
    pub spawnfile: String,
    pub spawnargs: Vec<String>,
    pub stdout: Option<Vec<u8>>,
    pub stderr: Option<Vec<u8>>,
    pub stdin: bool,
    pub connected: bool,
    pub killed: bool,
    pub exit_code: Option<i32>,
    pub signal_code: Option<String>,
    refed: bool,
}

impl ChildProcess {
    pub fn kill(&mut self) -> NodeResult<bool> {
        let Some(child) = self.child.as_mut() else {
            return Ok(false);
        };
        child
            .kill()
            .map_err(|error| NodeError::new("ESRCH", error.to_string()))?;
        self.killed = true;
        Ok(true)
    }

    pub fn wait(&mut self) -> NodeResult<SpawnOutput> {
        let Some(child) = self.child.take() else {
            return Ok(SpawnOutput {
                pid: self.pid,
                status: self.exit_code.unwrap_or(0),
                signal: self.signal_code.clone(),
                stdout: self.stdout.clone().unwrap_or_default(),
                stderr: self.stderr.clone().unwrap_or_default(),
                error: None,
            });
        };
        let pid = self.pid;
        let output = child
            .wait_with_output()
            .map_err(|error| NodeError::new("ECHILD", error.to_string()))?;
        let status = output.status.code().unwrap_or(1);
        self.exit_code = Some(status);
        self.stdout = Some(output.stdout.clone());
        self.stderr = Some(output.stderr.clone());
        Ok(SpawnOutput {
            pid,
            status,
            signal: None,
            stdout: output.stdout,
            stderr: output.stderr,
            error: None,
        })
    }

    pub fn ref_process(&mut self) {
        self.refed = true;
    }

    pub fn unref_process(&mut self) {
        self.refed = false;
    }

    pub fn has_ref(&self) -> bool {
        self.refed
    }

    pub fn disconnect(&mut self) {
        self.connected = false;
    }

    pub fn send(&self, _message: &str) -> NodeResult<bool> {
        if self.connected {
            Ok(true)
        } else {
            Err(NodeError::new(
                "ERR_IPC_CHANNEL_CLOSED",
                "child IPC channel is closed",
            ))
        }
    }
}

pub fn spawn_file_sync(program: &str, args: &[&str]) -> NodeResult<SpawnOutput> {
    spawn_file_sync_with_options(program, args, &SpawnOptions::default())
}

pub fn spawn_file_sync_with_options(
    program: &str,
    args: &[&str],
    options: &SpawnOptions,
) -> NodeResult<SpawnOutput> {
    validate_options(options)?;
    let mut command = configure_command(program, args, options);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    if options.input.is_some() {
        command.stdin(Stdio::piped());
    }
    let mut child = command
        .spawn()
        .map_err(|error| NodeError::new("ENOENT", error.to_string()))?;
    if let Some(input) = &options.input {
        let Some(stdin) = child.stdin.as_mut() else {
            return Err(NodeError::new(
                "ERR_CHILD_PROCESS_STDIN",
                "child stdin unavailable",
            ));
        };
        stdin
            .write_all(input)
            .map_err(|error| NodeError::new("EPIPE", error.to_string()))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| NodeError::new("ECHILD", error.to_string()))?;
    Ok(SpawnOutput {
        pid: None,
        status: output.status.code().unwrap_or(1),
        signal: None,
        stdout: output.stdout,
        stderr: output.stderr,
        error: None,
    })
}

pub fn spawn_sync(program: &str, args: &[&str]) -> NodeResult<SpawnOutput> {
    spawn_file_sync(program, args)
}

pub fn spawn_file(program: &str, args: &[&str]) -> NodeResult<ChildProcess> {
    spawn_file_with_options(program, args, &SpawnOptions::default())
}

pub fn spawn(program: &str, args: &[&str]) -> NodeResult<ChildProcess> {
    spawn_file(program, args)
}

pub fn spawn_file_with_options(
    program: &str,
    args: &[&str],
    options: &SpawnOptions,
) -> NodeResult<ChildProcess> {
    validate_options(options)?;
    let child = configure_command(program, args, options)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| NodeError::new("ENOENT", error.to_string()))?;
    let pid = Some(child.id());
    Ok(ChildProcess {
        child: Some(child),
        pid,
        spawnfile: program.to_string(),
        spawnargs: args.iter().map(|arg| (*arg).to_string()).collect(),
        stdout: None,
        stderr: None,
        stdin: true,
        connected: true,
        killed: false,
        exit_code: None,
        signal_code: None,
        refed: true,
    })
}

pub fn exec_file(program: &str, args: &[&str]) -> NodeResult<SpawnOutput> {
    spawn_file_sync(program, args)
}

pub fn exec_file_sync(program: &str, args: &[&str]) -> NodeResult<Vec<u8>> {
    let output = spawn_file_sync(program, args)?;
    if output.success() {
        Ok(output.stdout)
    } else {
        Err(NodeError::new(
            "ERR_CHILD_PROCESS_EXITED",
            format!("process exited with status {}", output.status),
        ))
    }
}

pub fn exec_file_sync_string(program: &str, args: &[&str]) -> NodeResult<String> {
    String::from_utf8(exec_file_sync(program, args)?)
        .map_err(|error| NodeError::new("ERR_INVALID_ARG_VALUE", error.to_string()))
}

pub fn exec_sync(program: &str, args: &[&str]) -> NodeResult<Vec<u8>> {
    exec_file_sync(program, args)
}

pub fn exec_command_sync(_command: &str) -> NodeResult<Vec<u8>> {
    Err(NodeError::new(
        "ERR_UNSUPPORTED_OPERATION",
        "shell command execution is not part of the closed runtime ABI; use exec_file_sync",
    ))
}

pub fn spawn_shell_sync(_command: &str) -> NodeResult<SpawnOutput> {
    Err(NodeError::new(
        "ERR_UNSUPPORTED_OPERATION",
        "shell execution is explicitly unsupported in generated Rust externals",
    ))
}

fn configure_command(program: &str, args: &[&str], options: &SpawnOptions) -> Command {
    let mut command = Command::new(program);
    command.args(args);
    if let Some(cwd) = &options.cwd {
        command.current_dir(cwd);
    }
    for (name, value) in &options.env {
        command.env(name, value);
    }
    command
}

fn validate_options(options: &SpawnOptions) -> NodeResult<()> {
    if options.shell {
        return Err(NodeError::new(
            "ERR_UNSUPPORTED_OPERATION",
            "shell execution is explicitly unsupported in generated Rust externals",
        ));
    }
    Ok(())
}
