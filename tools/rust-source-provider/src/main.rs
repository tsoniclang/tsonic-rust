#![feature(rustc_private)]

extern crate rustc_ast;
extern crate rustc_ast_pretty;
extern crate rustc_driver;
extern crate rustc_hir;
extern crate rustc_hir_typeck;
extern crate rustc_interface;
extern crate rustc_lint;
extern crate rustc_middle;
extern crate rustc_parse;
extern crate rustc_public;
extern crate rustc_session;
extern crate rustc_span;
extern crate serde;
extern crate serde_json;

mod evidence;
mod effects;
mod definitions;
mod inputs;
mod request;
mod source;
mod tokens;

use std::io::{Read, Write};
use std::path::PathBuf;

use request::{Request, Response};

fn execute() -> Result<(), String> {
    let arguments = std::env::args_os().skip(1).collect::<Vec<_>>();
    if arguments.len() != 2 {
        return Err("Expected request and response file paths.".to_owned());
    }
    let request_path = PathBuf::from(&arguments[0]);
    let response_path = PathBuf::from(&arguments[1]);
    let mut bytes = Vec::new();
    std::fs::File::open(request_path)
        .map_err(|error| error.to_string())?
        .take(request::MAXIMUM_REQUEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > request::MAXIMUM_REQUEST_BYTES {
        return Err("Native source request exceeds the byte limit.".to_owned());
    }
    let request: Request = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    request.validate()?;
    let output = match &request {
        Request::Tokens { edition, source, limits, .. } => request::encode_response(&Response::Tokens {
            protocol_version: request::PROTOCOL_VERSION,
            tokens: tokens::read_tokens(edition, source.clone(), limits)?,
        }, limits)?,
        Request::Analyze { arguments, phase, limits, .. } => evidence::analyze(arguments, *phase, limits)?,
    };
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(response_path)
        .map_err(|error| error.to_string())?;
    file.write_all(&output).map_err(|error| error.to_string())
}

fn main() {
    if let Err(error) = execute() {
        eprintln!("Rust source provider: {error}");
        std::process::exit(1);
    }
}
