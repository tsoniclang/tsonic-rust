#[derive(Default)]
pub struct ProcessEvents {
    emitter: EventEmitter,
}

impl ProcessEvents {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn on<F>(&mut self, event: impl Into<String>, listener: F) -> &mut Self
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.emitter.on(event, listener);
        self
    }

    pub fn add_listener<F>(&mut self, event: impl Into<String>, listener: F) -> &mut Self
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.on(event, listener)
    }

    pub fn on_with_id<F>(&mut self, event: impl Into<String>, listener: F) -> usize
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.emitter.on_with_id(event, listener)
    }

    pub fn once<F>(&mut self, event: impl Into<String>, listener: F) -> &mut Self
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.emitter.once(event, listener);
        self
    }

    pub fn prepend_listener<F>(&mut self, event: impl Into<String>, listener: F) -> &mut Self
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.emitter.prepend_listener(event, listener);
        self
    }

    pub fn prepend_once_listener<F>(&mut self, event: impl Into<String>, listener: F) -> &mut Self
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.emitter.prepend_once_listener(event, listener);
        self
    }

    pub fn emit(&mut self, event: &str, args: &[JsValue]) -> bool {
        self.emitter.emit(event, args)
    }

    pub fn off_by_id(&mut self, event: &str, listener_id: usize) -> &mut Self {
        self.emitter.off_by_id(event, listener_id);
        self
    }

    pub fn remove_listener_by_id(&mut self, event: &str, listener_id: usize) -> &mut Self {
        self.emitter.remove_listener_by_id(event, listener_id);
        self
    }

    pub fn remove_all_listeners(&mut self, event: Option<&str>) -> &mut Self {
        self.emitter.remove_all_listeners(event);
        self
    }

    pub fn listeners(&self, event: &str) -> Vec<usize> {
        self.emitter.listeners(event)
    }

    pub fn raw_listeners(&self, event: &str) -> Vec<usize> {
        self.emitter.raw_listeners(event)
    }

    pub fn event_names(&self) -> Vec<String> {
        self.emitter.event_names()
    }

    pub fn listener_count(&self, event: &str) -> usize {
        self.emitter.listener_count(event)
    }
}

pub fn exit(code: Option<i32>) -> ! {
    std::process::exit(code.unwrap_or_else(|| exit_code().unwrap_or(0)));
}

#[cfg(target_os = "linux")]
fn parent_process_id() -> Option<u32> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    status.lines().find_map(|line| {
        let value = line.strip_prefix("PPid:")?.trim();
        value.parse::<u32>().ok()
    })
}

#[cfg(not(target_os = "linux"))]
fn parent_process_id() -> Option<u32> {
    None
}

#[cfg(unix)]
fn getgroups_impl() -> NodeResult<Vec<u32>> {
    let count = unsafe { libc::getgroups(0, std::ptr::null_mut()) };
    if count < 0 {
        return Err(NodeError::new(
            "ERR_PROCESS_GROUPS",
            std::io::Error::last_os_error().to_string(),
        ));
    }
    let mut groups = vec![0 as libc::gid_t; count as usize];
    let actual = unsafe { libc::getgroups(count, groups.as_mut_ptr()) };
    if actual < 0 {
        return Err(NodeError::new(
            "ERR_PROCESS_GROUPS",
            std::io::Error::last_os_error().to_string(),
        ));
    }
    groups.truncate(actual as usize);
    Ok(groups)
}

#[cfg(not(unix))]
fn getgroups_impl() -> NodeResult<Vec<u32>> {
    Ok(Vec::new())
}

#[cfg(unix)]
fn kill_impl(pid: u32, signal: i32) -> NodeResult<bool> {
    if pid > i32::MAX as u32 {
        return Err(NodeError::new(
            "ERR_OUT_OF_RANGE",
            "pid is outside pid_t range",
        ));
    }
    let result = unsafe { libc::kill(pid as libc::pid_t, signal) };
    if result == 0 {
        Ok(true)
    } else {
        let error = std::io::Error::last_os_error();
        Err(NodeError::new("ESRCH", error.to_string()))
    }
}

#[cfg(not(unix))]
fn kill_impl(_pid: u32, _signal: i32) -> NodeResult<bool> {
    Err(NodeError::new(
        "ERR_FEATURE_UNAVAILABLE",
        "process.kill is currently implemented for Unix targets",
    ))
}

#[cfg(unix)]
fn umask_impl(mask: Option<u32>) -> u32 {
    let current = unsafe { libc::umask(mask.unwrap_or(0) as libc::mode_t) } as u32;
    if mask.is_none() {
        unsafe {
            libc::umask(current as libc::mode_t);
        }
    }
    current
}

#[cfg(not(unix))]
fn umask_impl(_mask: Option<u32>) -> u32 {
    0
}

#[cfg(target_os = "linux")]
fn current_rss_bytes() -> Option<u64> {
    let statm = std::fs::read_to_string("/proc/self/statm").ok()?;
    let pages = statm.split_whitespace().nth(1)?.parse::<u64>().ok()?;
    Some(pages * 4096)
}

#[cfg(not(target_os = "linux"))]
fn current_rss_bytes() -> Option<u64> {
    None
}

static PROCESS_TITLE: OnceLock<Mutex<String>> = OnceLock::new();
static WARNINGS: OnceLock<Mutex<Vec<ProcessWarning>>> = OnceLock::new();
static IPC_STATE: OnceLock<Mutex<ProcessIpcState>> = OnceLock::new();
static UNCAUGHT_EXCEPTION_CAPTURE: AtomicBool = AtomicBool::new(false);
static FINALIZATION_COUNT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

fn process_title() -> &'static Mutex<String> {
    PROCESS_TITLE.get_or_init(|| Mutex::new("tsonic-rust".to_string()))
}

fn warnings() -> &'static Mutex<Vec<ProcessWarning>> {
    WARNINGS.get_or_init(|| Mutex::new(Vec::new()))
}

fn ipc_state() -> &'static Mutex<ProcessIpcState> {
    IPC_STATE.get_or_init(|| Mutex::new(ProcessIpcState::default()))
}
