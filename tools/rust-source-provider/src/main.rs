#![feature(rustc_private)]

extern crate rustc_ast;
extern crate rustc_ast_pretty;
extern crate rustc_driver;
extern crate rustc_hir;
extern crate rustc_hir_analysis;
extern crate rustc_hir_typeck;
extern crate rustc_interface;
extern crate rustc_lint;
extern crate rustc_middle;
extern crate rustc_parse;
extern crate rustc_session;
extern crate rustc_span;
extern crate serde;
extern crate serde_json;

mod evidence;
mod cargo;
mod effects;
mod flow;
mod definitions;
mod inputs;
mod request;
mod source;
mod tokens;
mod type_model;
mod type_graph;
mod type_regions;
mod type_constants;
mod type_generics;
mod scopes;

use std::io::{Read, Write};
use std::path::PathBuf;

use request::{CompilationInput, Request, Response};

fn execute() -> Result<(), String> {
    let arguments = std::env::args_os().skip(1).collect::<Vec<_>>();
    if arguments.len() != 2 {
        return Err("Expected request and response file paths.".to_owned());
    }
    let request_path = PathBuf::from(&arguments[0]);
    let response_path = PathBuf::from(&arguments[1]);
    let request = read_request(&request_path)?;
    let output = match request {
        Request::Tokens { edition, source, limits, .. } => request::encode_response(&Response::Tokens {
            protocol_version: request::PROTOCOL_VERSION,
            tokens: tokens::read_tokens(&edition, source, &limits)?,
        }, &limits)?,
        Request::Analyze { compilation: CompilationInput::Compiler { arguments }, sources, phase, limits, .. } =>
            evidence::analyze(&arguments, sources, phase, &limits)?,
        Request::Analyze { compilation: CompilationInput::Cargo { manifest_path, package_id, target, target_directory, .. }, limits, .. } =>
            cargo::analyze(&request_path, &response_path, &manifest_path, &package_id, &target, &target_directory, &limits)?,
    };
    write_response(&response_path, &output)
}

fn read_request(path: &std::path::Path) -> Result<Request, String> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .map_err(|error| error.to_string())?
        .take(request::MAXIMUM_REQUEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > request::MAXIMUM_REQUEST_BYTES {
        return Err("Native source request exceeds the byte limit.".to_owned());
    }
    let request: Request = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    request.validate()?;
    Ok(request)
}

fn write_response(path: &std::path::Path, output: &[u8]) -> Result<(), String> {
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(output).map_err(|error| error.to_string())
}

fn main() {
    if cargo::is_wrapper() {
        match cargo::run_wrapper() {
            Ok(status) => std::process::exit(status),
            Err(error) => {
                eprintln!("Rust source provider: {error}");
                std::process::exit(1);
            }
        }
    }
    if let Err(error) = execute() {
        eprintln!("Rust source provider: {error}");
        std::process::exit(1);
    }
}
