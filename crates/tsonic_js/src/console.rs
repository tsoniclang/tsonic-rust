use std::collections::BTreeMap;
use std::io::{self, Write};
use std::time::Instant;

use crate::value::JsValue;

#[derive(Debug)]
pub struct Console {
    counts: BTreeMap<String, u64>,
    timers: BTreeMap<String, Instant>,
    group_depth: usize,
}

impl Default for Console {
    fn default() -> Self {
        Self::new()
    }
}

impl Console {
    pub fn new() -> Self {
        Self {
            counts: BTreeMap::new(),
            timers: BTreeMap::new(),
            group_depth: 0,
        }
    }

    pub fn format(&self, args: &[JsValue]) -> String {
        let prefix = "  ".repeat(self.group_depth);
        if prefix.is_empty() {
            format_args(args)
        } else {
            format!("{prefix}{}", format_args(args))
        }
    }

    pub fn log_to(&self, writer: &mut impl Write, args: &[JsValue]) -> io::Result<()> {
        writeln!(writer, "{}", self.format(args))
    }

    pub fn info_to(&self, writer: &mut impl Write, args: &[JsValue]) -> io::Result<()> {
        self.log_to(writer, args)
    }

    pub fn debug_to(&self, writer: &mut impl Write, args: &[JsValue]) -> io::Result<()> {
        self.log_to(writer, args)
    }

    pub fn warn_to(&self, writer: &mut impl Write, args: &[JsValue]) -> io::Result<()> {
        writeln!(writer, "{}", self.format(args))
    }

    pub fn error_to(&self, writer: &mut impl Write, args: &[JsValue]) -> io::Result<()> {
        writeln!(writer, "{}", self.format(args))
    }

    pub fn dir_to(&self, writer: &mut impl Write, item: &JsValue) -> io::Result<()> {
        writeln!(writer, "{}", item.inspect())
    }

    pub fn table_to(&self, writer: &mut impl Write, rows: &[JsValue]) -> io::Result<()> {
        for (index, row) in rows.iter().enumerate() {
            writeln!(writer, "{index}: {}", row.inspect())?;
        }
        Ok(())
    }

    pub fn trace_to(&self, writer: &mut impl Write, args: &[JsValue]) -> io::Result<()> {
        if args.is_empty() {
            writeln!(writer, "Trace")
        } else {
            writeln!(writer, "Trace: {}", self.format(args))
        }
    }

    pub fn assert_to(
        &self,
        writer: &mut impl Write,
        condition: bool,
        args: &[JsValue],
    ) -> io::Result<()> {
        if condition {
            Ok(())
        } else if args.is_empty() {
            writeln!(writer, "Assertion failed")
        } else {
            writeln!(writer, "Assertion failed: {}", self.format(args))
        }
    }

    pub fn count_to(&mut self, writer: &mut impl Write, label: Option<&str>) -> io::Result<u64> {
        let label = label.unwrap_or("default").to_string();
        let count = self.counts.entry(label.clone()).or_insert(0);
        *count += 1;
        writeln!(writer, "{label}: {count}")?;
        Ok(*count)
    }

    pub fn count_reset(&mut self, label: Option<&str>) {
        self.counts.remove(label.unwrap_or("default"));
    }

    pub fn time(&mut self, label: Option<&str>) {
        self.timers
            .insert(label.unwrap_or("default").to_string(), Instant::now());
    }

    pub fn time_log_to(
        &self,
        writer: &mut impl Write,
        label: Option<&str>,
        args: &[JsValue],
    ) -> io::Result<Option<u128>> {
        let label = label.unwrap_or("default");
        let Some(start) = self.timers.get(label) else {
            return Ok(None);
        };
        let elapsed = start.elapsed().as_millis();
        if args.is_empty() {
            writeln!(writer, "{label}: {elapsed}ms")?;
        } else {
            writeln!(writer, "{label}: {elapsed}ms {}", format_args(args))?;
        }
        Ok(Some(elapsed))
    }

    pub fn time_end_to(
        &mut self,
        writer: &mut impl Write,
        label: Option<&str>,
    ) -> io::Result<Option<u128>> {
        let label = label.unwrap_or("default");
        let Some(start) = self.timers.remove(label) else {
            return Ok(None);
        };
        let elapsed = start.elapsed().as_millis();
        writeln!(writer, "{label}: {elapsed}ms")?;
        Ok(Some(elapsed))
    }

    pub fn group_to(&mut self, writer: &mut impl Write, args: &[JsValue]) -> io::Result<()> {
        if !args.is_empty() {
            self.log_to(writer, args)?;
        }
        self.group_depth += 1;
        Ok(())
    }

    pub fn group_collapsed_to(
        &mut self,
        writer: &mut impl Write,
        args: &[JsValue],
    ) -> io::Result<()> {
        self.group_to(writer, args)
    }

    pub fn group_end(&mut self) {
        self.group_depth = self.group_depth.saturating_sub(1);
    }

    pub fn clear_to(&self, writer: &mut impl Write) -> io::Result<()> {
        writer.write_all(b"\x1b[2J\x1b[H")
    }
}

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

pub fn debug(args: &[JsValue]) {
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

pub fn debug_to(writer: &mut impl Write, args: &[JsValue]) -> io::Result<()> {
    log_to(writer, args)
}

pub fn dir_to(writer: &mut impl Write, item: &JsValue) -> io::Result<()> {
    writeln!(writer, "{}", item.inspect())
}

pub fn table_to(writer: &mut impl Write, rows: &[JsValue]) -> io::Result<()> {
    Console::new().table_to(writer, rows)
}

pub fn trace_to(writer: &mut impl Write, args: &[JsValue]) -> io::Result<()> {
    Console::new().trace_to(writer, args)
}

pub fn format_args(args: &[JsValue]) -> String {
    args.iter()
        .map(JsValue::inspect)
        .collect::<Vec<_>>()
        .join(" ")
}
