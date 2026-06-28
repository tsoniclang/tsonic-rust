use std::io::{self, Write};

use crate::value::JsValue;

pub fn log(args: &[JsValue]) {
    let mut out = io::stdout();
    let _ = log_to(&mut out, args);
}

pub fn error(args: &[JsValue]) {
    let mut out = io::stderr();
    let _ = error_to(&mut out, args);
}

pub fn warn(args: &[JsValue]) {
    let mut out = io::stderr();
    let _ = warn_to(&mut out, args);
}

pub fn info(args: &[JsValue]) {
    log(args);
}

pub fn log_to(writer: &mut impl Write, args: &[JsValue]) -> io::Result<()> {
    writeln!(writer, "{}", format_args(args))
}

pub fn error_to(writer: &mut impl Write, args: &[JsValue]) -> io::Result<()> {
    writeln!(writer, "{}", format_args(args))
}

pub fn warn_to(writer: &mut impl Write, args: &[JsValue]) -> io::Result<()> {
    writeln!(writer, "{}", format_args(args))
}

pub fn info_to(writer: &mut impl Write, args: &[JsValue]) -> io::Result<()> {
    log_to(writer, args)
}

pub fn format_args(args: &[JsValue]) -> String {
    args.iter()
        .map(JsValue::inspect)
        .collect::<Vec<_>>()
        .join(" ")
}
