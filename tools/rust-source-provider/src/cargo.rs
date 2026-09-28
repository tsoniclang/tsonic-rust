use std::ffi::OsString;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::request::{CargoTarget, CompilationInput, Limits, Request};

const REQUEST_ENV: &str = "TSONIC_NATIVE_CARGO_REQUEST";
const RESPONSE_ENV: &str = "TSONIC_NATIVE_CARGO_RESPONSE";
const EMIT_ENV: &str = "TSONIC_NATIVE_CARGO_EMIT";
const ROOT_STOP: i32 = 86;
const MAXIMUM_CONFIGURATION_BYTES: u64 = 8 * 1024 * 1024;

pub fn is_wrapper() -> bool {
    std::env::var_os(REQUEST_ENV).is_some()
}

pub fn analyze(
    request_path: &Path,
    response_path: &Path,
    manifest_path: &str,
    package_id: &str,
    target: &CargoTarget,
    target_directory: &str,
    limits: &Limits,
) -> Result<Vec<u8>, String> {
    let manifest = std::fs::canonicalize(manifest_path).map_err(|error| error.to_string())?;
    let directory = manifest.parent().ok_or("Native Cargo manifest has no containing directory.")?;
    require_available_wrapper(directory)?;
    let compiler_response = response_path.with_extension("cargo.json");
    let started = response_path.with_extension("cargo.started");
    let duplicate = response_path.with_extension("cargo.duplicate");
    for path in [&compiler_response, &started, &duplicate] {
        if path.try_exists().map_err(|error| error.to_string())? {
            return Err("Native Cargo request state already exists.".to_owned());
        }
    }
    let mut command = Command::new("cargo");
    command.current_dir(directory).args(["rustc", "--locked", "--manifest-path"])
        .arg(&manifest).args(["--package", package_id, "--target-dir", target_directory]);
    match target {
        CargoTarget::Library => { command.arg("--lib"); }
        CargoTarget::Binary { name } => { command.arg("--bin").arg(name); }
    }
    let emit = evidence_output_argument(target_directory);
    command.arg("--").arg(&emit)
        .env("RUSTC_WORKSPACE_WRAPPER", std::env::current_exe().map_err(|error| error.to_string())?)
        .env(REQUEST_ENV, request_path)
        .env(RESPONSE_ENV, response_path)
        .env(EMIT_ENV, &emit)
        .stdin(Stdio::null());
    let status = command.status().map_err(|error| error.to_string())?;
    if status.code() != Some(101) || !started.try_exists().map_err(|error| error.to_string())? ||
        duplicate.try_exists().map_err(|error| error.to_string())? {
        return Err(format!("Cargo did not stop at one exact native evidence request ({status})."));
    }
    let mut bytes = Vec::new();
    std::fs::File::open(&compiler_response)
        .map_err(|error| format!("Cargo source checking did not produce accepted native evidence: {error}"))?
        .take(limits.maximum_output_bytes as u64 + 1)
        .read_to_end(&mut bytes).map_err(|error| error.to_string())?;
    if bytes.len() > limits.maximum_output_bytes {
        return Err("Native Cargo evidence exceeds the output byte limit.".to_owned());
    }
    Ok(bytes)
}

fn require_available_wrapper(directory: &Path) -> Result<(), String> {
    if let Some(value) = std::env::var_os("RUSTC_WORKSPACE_WRAPPER") {
        return if value.is_empty() { Ok(()) } else {
            Err("Native Cargo source checking cannot replace an existing RUSTC_WORKSPACE_WRAPPER.".to_owned())
        };
    }
    let mut command = Command::new("cargo");
    command.current_dir(directory).env("RUSTC_BOOTSTRAP", "1")
        .args(["-Z", "unstable-options", "config", "get", "--format=json"]);
    let bytes = bounded_stdout(&mut command, MAXIMUM_CONFIGURATION_BYTES)?;
    let config: serde_json::Value = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    let config = config.as_object().ok_or("Cargo configuration must be a data object.")?;
    if let Some(build) = config.get("build") {
        let build = build.as_object().ok_or("Cargo build configuration must be a data object.")?;
        if let Some(wrapper) = build.get("rustc-workspace-wrapper") {
            if !wrapper.as_str().is_some_and(str::is_empty) {
                return Err("Native Cargo source checking cannot replace configured build.rustc-workspace-wrapper.".to_owned());
            }
        }
    }
    Ok(())
}

pub fn run_wrapper() -> Result<i32, String> {
    let request_path = PathBuf::from(std::env::var_os(REQUEST_ENV).ok_or("Native Cargo wrapper has no request.")?);
    let response_path = PathBuf::from(std::env::var_os(RESPONSE_ENV).ok_or("Native Cargo wrapper has no response path.")?);
    let mut arguments = std::env::args_os().skip(1);
    let compiler = arguments.next().ok_or("Native Cargo wrapper did not receive the compiler executable.")?;
    let arguments = arguments.collect::<Vec<_>>();
    let emit = std::env::var_os(EMIT_ENV).ok_or("Native Cargo wrapper requires its exact output selection.")?;
    if !arguments.contains(&emit) {
        let status = Command::new(compiler).args(arguments).env_remove(REQUEST_ENV).env_remove(RESPONSE_ENV)
            .env_remove(EMIT_ENV)
            .status().map_err(|error| error.to_string())?;
        return Ok(status.code().unwrap_or(1));
    }
    let request = crate::read_request(&request_path)?;
    let Request::Analyze {
        compilation: CompilationInput::Cargo { target_directory, compiler_identity, sysroot, .. },
        phase, limits, ..
    } = request else {
        return Err("Native Cargo wrapper requires a Cargo analysis request.".to_owned());
    };
    if emit != OsString::from(evidence_output_argument(&target_directory)) ||
        arguments.iter().filter(|argument| **argument == emit).count() != 1 {
        return Err("Native Cargo wrapper selection differs from its request.".to_owned());
    }
    let started = response_path.with_extension("cargo.started");
    if let Err(error) = std::fs::OpenOptions::new().write(true).create_new(true).open(started) {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            crate::write_response(&response_path.with_extension("cargo.duplicate"), b"duplicate root")?;
        }
        return Err(format!("Native Cargo root invocation is not unique: {error}"));
    }
    let version = bounded_stdout(Command::new(&compiler).arg("-vV"), 8192)?;
    if std::str::from_utf8(&version).map_err(|error| error.to_string())?.trim() != compiler_identity.trim() {
        return Err("Cargo selected a different compiler than the native evidence service.".to_owned());
    }
    let selected_sysroot = bounded_stdout(Command::new(&compiler).args(["--print", "sysroot"]), 8192)?;
    let selected_sysroot = std::str::from_utf8(&selected_sysroot).map_err(|error| error.to_string())?.trim();
    if std::fs::canonicalize(selected_sysroot).map_err(|error| error.to_string())? !=
        std::fs::canonicalize(&sysroot).map_err(|error| error.to_string())? {
        return Err("Cargo selected a different sysroot than the native evidence service.".to_owned());
    }
    let arguments = std::iter::once(compiler).chain(arguments).map(|argument| {
        argument.into_string().map_err(|_| "Native Cargo compiler arguments require exact Unicode.".to_owned())
    }).collect::<Result<Vec<_>, _>>()?;
    let output = crate::evidence::analyze(&arguments, phase, &limits)?;
    crate::write_response(&response_path.with_extension("cargo.json"), &output)?;
    Ok(ROOT_STOP)
}

fn evidence_output_argument(target_directory: &str) -> String {
    format!("--emit=metadata={}", Path::new(target_directory).join("tsonic-source-evidence.rmeta").display())
}

fn bounded_stdout(command: &mut Command, maximum: u64) -> Result<Vec<u8>, String> {
    let mut child = command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::inherit())
        .spawn().map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    let result = child.stdout.take().ok_or("Native Cargo command has no stdout pipe.")?
        .take(maximum + 1).read_to_end(&mut bytes);
    if result.is_err() || bytes.len() as u64 > maximum {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Native Cargo configuration output failed or exceeded its byte limit.".to_owned());
    }
    let status = child.wait().map_err(|error| error.to_string())?;
    if !status.success() { return Err(format!("Native Cargo configuration command failed ({status}).")); }
    Ok(bytes)
}
