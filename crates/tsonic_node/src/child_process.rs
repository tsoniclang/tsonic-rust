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

#[derive(Debug)]
pub struct ChildProcess {
    child: Option<OsChild>,
    pub pid: Option<u32>,
    pub spawnfile: String,
    pub spawnargs: Vec<String>,
    pub stdio: Vec<Stdio>,
    pub channel: Option<String>,
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
        self.kill_with_signal(None)
    }

    pub fn kill_with_signal(&mut self, signal: Option<&str>) -> NodeResult<bool> {
        let Some(child) = self.child.as_mut() else {
            return Ok(false);
        };
        child
            .kill()
            .map_err(|error| NodeError::new("ESRCH", error.to_string()))?;
        self.killed = true;
        self.signal_code = signal.map(|value| value.to_string());
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
        self.channel = None;
    }

    pub fn send(&self, _message: &str) -> NodeResult<bool> {
        self.send_with_options(_message, &MessagingOptions::default())
    }

    pub fn send_with_options(
        &self,
        _message: &str,
        options: &MessagingOptions,
    ) -> NodeResult<bool> {
        if self.connected {
            Ok(!options.keep_open)
        } else {
            Err(NodeError::new(
                "ERR_IPC_CHANNEL_CLOSED",
                "child IPC channel is closed",
            ))
        }
    }

    pub fn snapshot(&self) -> ChildProcessSnapshot {
        ChildProcessSnapshot {
            pid: self.pid,
            spawnfile: self.spawnfile.clone(),
            spawnargs: self.spawnargs.clone(),
            connected: self.connected,
            killed: self.killed,
            exit_code: self.exit_code,
            signal_code: self.signal_code.clone(),
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
    apply_stdio(&mut command, &options.stdio, options.input.is_some());
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
    enforce_max_buffer(&output.stdout, output.stderr.as_slice(), options.max_buffer)?;
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
    let mut command = configure_command(program, args, options);
    apply_stdio(&mut command, &options.stdio, false);
    let child = command
        .spawn()
        .map_err(|error| NodeError::new("ENOENT", error.to_string()))?;
    let pid = Some(child.id());
    Ok(ChildProcess {
        child: Some(child),
        pid,
        spawnfile: program.to_string(),
        spawnargs: args.iter().map(|arg| (*arg).to_string()).collect(),
        stdio: vec![
            options.stdio.stdin,
            options.stdio.stdout,
            options.stdio.stderr,
        ],
        channel: Some("ipc".to_string()),
        stdout: None,
        stderr: None,
        stdin: matches!(options.stdio.stdin, Stdio::Pipe | Stdio::Ipc),
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

pub fn exec_file_with_options(
    program: &str,
    args: &[&str],
    options: &SpawnOptions,
) -> NodeResult<SpawnOutput> {
    spawn_file_sync_with_options(program, args, options)
}

pub fn exec_file_promisify(
    program: &str,
    args: &[&str],
    options: &SpawnOptions,
) -> NodeResult<PromiseWithChild<SpawnOutput>> {
    let mut child = spawn_file_with_options(program, args, options)?;
    let output = child.wait()?;
    Ok(PromiseWithChild {
        value: output,
        child: child.snapshot(),
    })
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

pub fn exec_sync_with_options(
    program: &str,
    args: &[&str],
    options: &SpawnOptions,
) -> NodeResult<Vec<u8>> {
    let output = spawn_file_sync_with_options(program, args, options)?;
    if output.success() {
        Ok(output.stdout)
    } else {
        Err(NodeError::new(
            "ERR_CHILD_PROCESS_EXITED",
            format!("process exited with status {}", output.status),
        ))
    }
}

pub fn fork_file(program: &str, args: &[&str], options: &SpawnOptions) -> NodeResult<ChildProcess> {
    spawn_file_with_options(program, args, options)
}

pub fn exec_exception(command: impl Into<String>, output: &SpawnOutput) -> ExecException {
    ExecException {
        cmd: command.into(),
        code: Some(output.status),
        killed: false,
        signal: output.signal.clone(),
        stdout: output.stdout.clone(),
        stderr: output.stderr.clone(),
    }
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
    if options.signal_aborted {
        return Err(NodeError::new(
            "ABORT_ERR",
            "child process start was cancelled by an explicit abort signal",
        ));
    }
    Ok(())
}

fn apply_stdio(command: &mut Command, options: &StdioOptions, force_stdin_pipe: bool) {
    command.stdin(to_process_stdio(options.stdin, force_stdin_pipe));
    command.stdout(to_process_stdio(options.stdout, false));
    command.stderr(to_process_stdio(options.stderr, false));
}

fn to_process_stdio(stdio: Stdio, force_pipe: bool) -> std::process::Stdio {
    if force_pipe {
        return std::process::Stdio::piped();
    }
    match stdio {
        Stdio::Pipe | Stdio::Ipc => std::process::Stdio::piped(),
        Stdio::Ignore => std::process::Stdio::null(),
        Stdio::Inherit => std::process::Stdio::inherit(),
    }
}

fn enforce_max_buffer(stdout: &[u8], stderr: &[u8], max_buffer: Option<usize>) -> NodeResult<()> {
    let Some(max_buffer) = max_buffer else {
        return Ok(());
    };
    if stdout.len() > max_buffer || stderr.len() > max_buffer {
        return Err(NodeError::new(
            "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
            "child process output exceeded maxBuffer",
        ));
    }
    Ok(())
}
