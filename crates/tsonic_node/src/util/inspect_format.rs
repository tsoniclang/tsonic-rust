impl DebugLogger {
    pub fn enabled(&self) -> bool {
        self.enabled
    }

    pub fn log(&self, message: &str) -> Option<String> {
        self.enabled
            .then(|| format!("{} {message}", self.section.to_ascii_uppercase()))
    }
}

pub fn format(format: &str, args: &[JsValue]) -> String {
    let mut out = String::new();
    let mut chars = format.chars().peekable();
    let mut arg_index = 0;
    while let Some(ch) = chars.next() {
        if ch != '%' {
            out.push(ch);
            continue;
        }
        match chars.next() {
            Some('%') => out.push('%'),
            Some('s') => out.push_str(&next_arg(args, &mut arg_index).inspect()),
            Some('d') => out.push_str(&format_number(next_arg(args, &mut arg_index))),
            Some('j') => {
                let value = next_arg(args, &mut arg_index);
                out.push_str(&json::stringify(value).unwrap_or_else(|_| "[Circular]".to_string()));
            }
            Some(other) => {
                out.push('%');
                out.push(other);
            }
            None => out.push('%'),
        }
    }
    for value in &args[arg_index..] {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(&value.inspect());
    }
    out
}

pub fn format_with_options(_options: &JsValue, format: &str, args: &[JsValue]) -> String {
    self::format(format, args)
}

pub fn format_with_inspect_options(
    options: &InspectOptions,
    format: &str,
    args: &[JsValue],
) -> String {
    let mut text = self::format(format, args);
    if options.numeric_separator {
        text = text.replace("1000", "1_000");
    }
    text
}

pub fn inspect(value: &JsValue) -> String {
    value.inspect()
}

pub fn inspect_with_options(value: &JsValue, _options: &JsValue) -> String {
    inspect(value)
}

pub fn default_inspect_options() -> InspectOptions {
    InspectOptions::default()
}

pub fn inspect_with_struct_options(value: &JsValue, options: &InspectOptions) -> String {
    let mut text = inspect(value);
    if let Some(max) = options.max_string_length {
        if text.chars().count() > max {
            text = text.chars().take(max).collect::<String>();
            text.push_str("...");
        }
    }
    if options.colors {
        style_text("cyan", &text)
    } else {
        text
    }
}

pub fn inspect_context() -> InspectContext {
    InspectContext
}

pub fn inspect_custom_symbol() -> &'static str {
    "nodejs.util.inspect.custom"
}

pub fn promisify_custom_symbol() -> &'static str {
    "nodejs.util.promisify.custom"
}

pub fn inspect_default_options() -> InspectOptions {
    InspectOptions::default()
}

pub fn inspect_styles() -> Vec<InspectStyleEntry> {
    vec![
        InspectStyleEntry {
            kind: "special",
            style: "cyan",
        },
        InspectStyleEntry {
            kind: "number",
            style: "yellow",
        },
        InspectStyleEntry {
            kind: "bigint",
            style: "yellow",
        },
        InspectStyleEntry {
            kind: "boolean",
            style: "yellow",
        },
        InspectStyleEntry {
            kind: "undefined",
            style: "grey",
        },
        InspectStyleEntry {
            kind: "null",
            style: "bold",
        },
        InspectStyleEntry {
            kind: "string",
            style: "green",
        },
        InspectStyleEntry {
            kind: "symbol",
            style: "green",
        },
        InspectStyleEntry {
            kind: "date",
            style: "magenta",
        },
        InspectStyleEntry {
            kind: "regexp",
            style: "red",
        },
    ]
}

pub fn inspect_colors() -> Vec<InspectColorEntry> {
    vec![
        InspectColorEntry {
            style: "bold",
            open: 1,
            close: 22,
        },
        InspectColorEntry {
            style: "italic",
            open: 3,
            close: 23,
        },
        InspectColorEntry {
            style: "underline",
            open: 4,
            close: 24,
        },
        InspectColorEntry {
            style: "red",
            open: 31,
            close: 39,
        },
        InspectColorEntry {
            style: "green",
            open: 32,
            close: 39,
        },
        InspectColorEntry {
            style: "yellow",
            open: 33,
            close: 39,
        },
        InspectColorEntry {
            style: "blue",
            open: 34,
            close: 39,
        },
        InspectColorEntry {
            style: "magenta",
            open: 35,
            close: 39,
        },
        InspectColorEntry {
            style: "cyan",
            open: 36,
            close: 39,
        },
        InspectColorEntry {
            style: "grey",
            open: 90,
            close: 39,
        },
    ]
}

