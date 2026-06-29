pub fn exit_code() -> Option<i32> {
    let code = EXIT_CODE.load(Ordering::SeqCst);
    if code == i32::MIN {
        None
    } else {
        Some(code)
    }
}

pub fn set_exit_code(code: i32) {
    EXIT_CODE.store(code, Ordering::SeqCst);
}

pub fn next_tick(callback: impl FnOnce()) {
    callback();
}

pub fn connected() -> bool {
    ipc_state().lock().unwrap().connected
}

pub fn channel() -> Option<String> {
    ipc_state().lock().unwrap().channel.clone()
}

pub fn main_module() -> Option<String> {
    ipc_state().lock().unwrap().main_module.clone()
}

pub fn disconnect() -> NodeResult<()> {
    if !connected() {
        return Err(NodeError::new(
            "ERR_IPC_CHANNEL_CLOSED",
            "process IPC channel is not connected",
        ));
    }
    ipc_state().lock().unwrap().connected = false;
    Ok(())
}

pub fn send(_message: &JsValue) -> NodeResult<bool> {
    if connected() {
        Ok(true)
    } else {
        Err(NodeError::new(
            "ERR_IPC_CHANNEL_CLOSED",
            "process IPC channel is not connected",
        ))
    }
}

pub fn no_deprecation() -> bool {
    false
}

pub fn throw_deprecation() -> bool {
    false
}

pub fn trace_deprecation() -> bool {
    false
}

pub fn trace_process_warnings() -> bool {
    false
}

pub fn has_uncaught_exception_capture_callback() -> bool {
    UNCAUGHT_EXCEPTION_CAPTURE.load(Ordering::SeqCst)
}

pub fn set_uncaught_exception_capture_callback(enabled: bool) {
    UNCAUGHT_EXCEPTION_CAPTURE.store(enabled, Ordering::SeqCst);
}

pub fn add_uncaught_exception_capture_callback() {
    set_uncaught_exception_capture_callback(true);
}

pub fn abort() -> NodeResult<()> {
    Err(NodeError::new(
        "ERR_PROCESS_ABORT_UNSUPPORTED",
        "process.abort is not exposed by the closed generated Rust runtime",
    ))
}

pub fn execve(_file: &str, _args: &[&str], _env: &[(&str, &str)]) -> NodeResult<()> {
    Err(NodeError::new(
        "ERR_PROCESS_EXECVE_UNSUPPORTED",
        "process.execve would replace the native process image and is not exposed",
    ))
}

pub fn finalization() -> ProcessFinalization {
    ProcessFinalization {
        registered_count: FINALIZATION_COUNT.load(Ordering::SeqCst),
    }
}

pub fn finalization_register() {
    FINALIZATION_COUNT.fetch_add(1, Ordering::SeqCst);
}

pub fn finalization_unregister() {
    FINALIZATION_COUNT
        .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |value| {
            value.checked_sub(1)
        })
        .ok();
}

pub fn stdout() -> Writable {
    Writable::new()
}

pub fn stderr() -> Writable {
    Writable::new()
}

pub fn stdin_is_tty() -> bool {
    false
}

pub fn umask(mask: Option<u32>) -> u32 {
    umask_impl(mask)
}

pub fn source_maps_enabled() -> bool {
    false
}

pub fn debug_port() -> u16 {
    0
}

pub fn get_builtin_module(id: &str) -> Option<&'static str> {
    crate::module::builtin_modules()
        .into_iter()
        .find(|module| *module == id || format!("node:{module}") == id)
}

pub fn ref_handle<T>(_value: &T) {}

pub fn unref_handle<T>(_value: &T) {}
