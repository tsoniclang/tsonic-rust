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
