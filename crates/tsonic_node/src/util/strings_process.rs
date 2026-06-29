pub fn is_deep_strict_equal(left: &JsValue, right: &JsValue) -> bool {
    left == right
}

pub fn is_deep_strict_equal_with_options(
    left: &JsValue,
    right: &JsValue,
    _options: IsDeepStrictEqualOptions,
) -> bool {
    is_deep_strict_equal(left, right)
}

pub fn diff(actual: &str, expected: &str) -> Vec<DiffEntry> {
    if actual == expected {
        return vec![DiffEntry {
            operation: 0,
            value: actual.to_string(),
        }];
    }
    let actual_units = split_diff_units(actual);
    let expected_units = split_diff_units(expected);
    let mut entries = Vec::new();
    let max = actual_units.len().max(expected_units.len());
    for index in 0..max {
        match (actual_units.get(index), expected_units.get(index)) {
            (Some(left), Some(right)) if left == right => entries.push(DiffEntry {
                operation: 0,
                value: (*left).to_string(),
            }),
            (Some(left), Some(right)) => {
                entries.push(DiffEntry {
                    operation: -1,
                    value: (*left).to_string(),
                });
                entries.push(DiffEntry {
                    operation: 1,
                    value: (*right).to_string(),
                });
            }
            (Some(left), None) => entries.push(DiffEntry {
                operation: -1,
                value: (*left).to_string(),
            }),
            (None, Some(right)) => entries.push(DiffEntry {
                operation: 1,
                value: (*right).to_string(),
            }),
            (None, None) => {}
        }
    }
    entries
}

pub fn strip_vt_control_characters(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == 0x1b {
            index += 1;
            if index < bytes.len() && bytes[index] == b'[' {
                index += 1;
                while index < bytes.len() && !bytes[index].is_ascii_alphabetic() {
                    index += 1;
                }
                if index < bytes.len() {
                    index += 1;
                }
            }
            continue;
        }
        output.push(bytes[index] as char);
        index += 1;
    }
    output
}

pub fn to_usv_string(value: &str) -> String {
    value.chars().collect()
}

pub fn deprecate<T>(function: T, _message: &str) -> T {
    function
}

pub fn deprecate_with_options<T>(function: T, _message: &str, _options: DeprecateOptions) -> T {
    function
}

pub fn inherits(child_name: &str, parent_name: &str) -> (String, String) {
    (child_name.to_string(), parent_name.to_string())
}

pub fn promisify<T>(function: T) -> T {
    function
}

pub fn callbackify<T>(function: T) -> T {
    function
}

pub fn aborted(signal: &AbortSignal) -> bool {
    signal.aborted()
}

pub fn transferable_abort_signal(signal: &AbortSignal) -> AbortSignal {
    signal.clone()
}

pub fn transferable_abort_controller() -> AbortController {
    AbortController::new()
}

pub fn get_call_sites() -> Vec<CallSite> {
    vec![CallSite::new(
        Some("getCallSites".to_string()),
        Some("tsonic:generated".to_string()),
    )
    .with_position(1, 1)]
}

pub fn get_call_sites_with_options(_options: GetCallSitesOptions) -> Vec<CallSiteObject> {
    get_call_sites().iter().map(CallSiteObject::from).collect()
}

pub fn debuglog(section: &str, enabled_sections: &[&str]) -> DebugLogger {
    DebugLogger {
        section: section.to_string(),
        enabled: enabled_sections
            .iter()
            .any(|enabled| enabled.eq_ignore_ascii_case(section)),
    }
}

pub fn style_text(style: &str, text: &str) -> String {
    let code = match style {
        "red" => Some(31),
        "green" => Some(32),
        "yellow" => Some(33),
        "blue" => Some(34),
        "magenta" => Some(35),
        "cyan" => Some(36),
        "gray" | "grey" => Some(90),
        "bold" => Some(1),
        "underline" => Some(4),
        _ => None,
    };
    if let Some(code) = code {
        format!("\u{1b}[{code}m{text}\u{1b}[0m")
    } else {
        text.to_string()
    }
}

pub fn style_text_with_options(style: &str, text: &str, _options: &StyleTextOptions) -> String {
    style_text(style, text)
}

pub fn get_system_error_name(code: i32) -> &'static str {
    match code {
        1 => "EPERM",
        2 => "ENOENT",
        13 => "EACCES",
        17 => "EEXIST",
        22 => "EINVAL",
        _ => "ERR_SYSTEM_ERROR",
    }
}

pub fn get_system_error_message(code: i32) -> &'static str {
    match code {
        1 => "operation not permitted",
        2 => "no such file or directory",
        13 => "permission denied",
        17 => "file already exists",
        22 => "invalid argument",
        _ => "system error",
    }
}

pub fn get_system_error_map() -> Vec<SystemErrorEntry> {
    [1, 2, 13, 17, 22]
        .into_iter()
        .map(|code| SystemErrorEntry {
            code,
            name: get_system_error_name(code),
            message: get_system_error_message(code),
        })
        .collect()
}

pub fn convert_process_signal_to_exit_code(signal: &str) -> Option<i32> {
    match signal {
        "SIGHUP" => Some(129),
        "SIGINT" => Some(130),
        "SIGQUIT" => Some(131),
        "SIGILL" => Some(132),
        "SIGABRT" => Some(134),
        "SIGKILL" => Some(137),
        "SIGTERM" => Some(143),
        _ => None,
    }
}

pub fn set_trace_sigint(_enable: bool) {}

