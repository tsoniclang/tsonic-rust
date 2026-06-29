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

