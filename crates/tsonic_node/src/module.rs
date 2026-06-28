#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Require {
    base: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceMapPayload {
    pub version: u32,
    pub sources: Vec<String>,
    pub names: Vec<String>,
    pub mappings: String,
    pub source_root: Option<String>,
    pub sources_content: Option<Vec<Option<String>>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceMapConstructorOptions {
    pub line_lengths: Option<Vec<usize>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceMapping {
    pub generated_line: u32,
    pub generated_column: u32,
    pub original_source: String,
    pub original_line: u32,
    pub original_column: u32,
    pub name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceOrigin {
    pub file_name: String,
    pub line_number: u32,
    pub column_number: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceMap {
    payload: SourceMapPayload,
    options: SourceMapConstructorOptions,
    decoded_mappings: Vec<SourceMapping>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SourceMapsSupport {
    pub node_modules: bool,
    pub generated_code: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StripTypeScriptMode {
    Strip,
    Transform,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StripTypeScriptTypesOptions {
    pub mode: StripTypeScriptMode,
    pub source_map: bool,
    pub source_url: Option<String>,
}

impl Require {
    pub fn base(&self) -> &str {
        &self.base
    }

    pub fn resolve(&self, specifier: &str) -> String {
        if specifier.starts_with("./") || specifier.starts_with("../") {
            format!("{}/{}", self.base.trim_end_matches('/'), specifier)
        } else {
            specifier.to_string()
        }
    }
}

impl SourceMapPayload {
    pub fn new(
        version: u32,
        sources: Vec<String>,
        names: Vec<String>,
        mappings: impl Into<String>,
    ) -> Self {
        Self {
            version,
            sources,
            names,
            mappings: mappings.into(),
            source_root: None,
            sources_content: None,
        }
    }
}

impl SourceMapConstructorOptions {
    pub fn new(line_lengths: Option<Vec<usize>>) -> Self {
        Self { line_lengths }
    }
}

impl SourceMap {
    pub fn new(payload: SourceMapPayload, options: Option<SourceMapConstructorOptions>) -> Self {
        Self {
            payload,
            options: options.unwrap_or_else(|| SourceMapConstructorOptions::new(None)),
            decoded_mappings: Vec::new(),
        }
    }

    pub fn with_decoded_mappings(
        payload: SourceMapPayload,
        options: Option<SourceMapConstructorOptions>,
        decoded_mappings: Vec<SourceMapping>,
    ) -> Self {
        Self {
            payload,
            options: options.unwrap_or_else(|| SourceMapConstructorOptions::new(None)),
            decoded_mappings,
        }
    }

    pub fn payload(&self) -> &SourceMapPayload {
        &self.payload
    }

    pub fn line_lengths(&self) -> Option<&[usize]> {
        self.options.line_lengths.as_deref()
    }

    pub fn find_entry(&self, line_number: u32, column_number: u32) -> Option<&SourceMapping> {
        self.decoded_mappings
            .iter()
            .filter(|mapping| {
                mapping.generated_line < line_number
                    || (mapping.generated_line == line_number
                        && mapping.generated_column <= column_number)
            })
            .max_by_key(|mapping| (mapping.generated_line, mapping.generated_column))
    }

    pub fn find_origin(&self, line_number: u32, column_number: u32) -> Option<SourceOrigin> {
        self.find_entry(line_number, column_number)
            .map(|mapping| SourceOrigin {
                file_name: mapping.original_source.clone(),
                line_number: mapping.original_line,
                column_number: mapping.original_column,
            })
    }
}

pub fn builtin_modules() -> Vec<&'static str> {
    vec![
        "assert",
        "async_hooks",
        "buffer",
        "child_process",
        "cluster",
        "console",
        "crypto",
        "dgram",
        "diagnostics_channel",
        "dns",
        "events",
        "fs",
        "fs/promises",
        "http",
        "http2",
        "https",
        "module",
        "net",
        "os",
        "path",
        "perf_hooks",
        "process",
        "punycode",
        "querystring",
        "readline",
        "sqlite",
        "stream",
        "string_decoder",
        "timers",
        "timers/promises",
        "tls",
        "tty",
        "url",
        "util",
        "worker_threads",
        "zlib",
    ]
}

pub fn create_require(base: impl Into<String>) -> Require {
    Require { base: base.into() }
}

pub fn is_builtin(specifier: &str) -> bool {
    let normalized = specifier.strip_prefix("node:").unwrap_or(specifier);
    builtin_modules().contains(&normalized)
}

pub fn sync_builtin_esm_exports() {}

pub fn find_package_json(specifier: &str, base: Option<&str>) -> Option<String> {
    let mut directory = std::path::PathBuf::from(base.unwrap_or("."));
    if directory.is_file() {
        directory.pop();
    }
    loop {
        let candidate = directory.join(specifier).join("package.json");
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
        let direct = directory.join("package.json");
        if specifier == "." && direct.is_file() {
            return Some(direct.to_string_lossy().into_owned());
        }
        if !directory.pop() {
            return None;
        }
    }
}

pub fn get_source_maps_support() -> SourceMapsSupport {
    *source_maps_support().lock().unwrap()
}

pub fn set_source_maps_support(enabled: bool, node_modules: bool) -> SourceMapsSupport {
    let support = SourceMapsSupport {
        node_modules,
        generated_code: enabled,
    };
    *source_maps_support().lock().unwrap() = support;
    support
}

pub fn strip_type_script_types(
    source: &str,
    options: Option<StripTypeScriptTypesOptions>,
) -> String {
    let options = options.unwrap_or(StripTypeScriptTypesOptions {
        mode: StripTypeScriptMode::Strip,
        source_map: false,
        source_url: None,
    });
    let mut output = String::new();
    for line in source.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("type ") || trimmed.starts_with("interface ") {
            continue;
        }
        output.push_str(&strip_type_annotations(line));
        output.push('\n');
    }
    if options.source_map {
        output.push_str("\n//# sourceMappingURL=data:application/json;base64,\n");
    }
    if let Some(source_url) = options.source_url {
        output.push_str("//# sourceURL=");
        output.push_str(&source_url);
        output.push('\n');
    }
    if matches!(options.mode, StripTypeScriptMode::Transform) {
        output = output.replace(" as const", "");
    }
    output
}

fn strip_type_annotations(line: &str) -> String {
    let mut output = String::with_capacity(line.len());
    let chars = line.chars().collect::<Vec<_>>();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == ':' && is_annotation_start(&chars, index) {
            index += 1;
            while index < chars.len() && chars[index].is_whitespace() {
                index += 1;
            }
            while index < chars.len() && is_type_annotation_char(chars[index]) {
                index += 1;
            }
            continue;
        }
        output.push(chars[index]);
        index += 1;
    }
    output
}

fn is_annotation_start(chars: &[char], index: usize) -> bool {
    index > 0
        && chars[index - 1] != ':'
        && chars
            .get(index + 1)
            .is_some_and(|ch| ch.is_whitespace() || ch.is_alphabetic() || *ch == '{')
}

fn is_type_annotation_char(ch: char) -> bool {
    ch.is_alphanumeric()
        || matches!(
            ch,
            '_' | '$' | '.' | '<' | '>' | '[' | ']' | '|' | '&' | '?' | ',' | ' ' | '\t'
        )
}

fn source_maps_support() -> &'static std::sync::Mutex<SourceMapsSupport> {
    static SOURCE_MAPS_SUPPORT: std::sync::OnceLock<std::sync::Mutex<SourceMapsSupport>> =
        std::sync::OnceLock::new();
    SOURCE_MAPS_SUPPORT.get_or_init(|| {
        std::sync::Mutex::new(SourceMapsSupport {
            node_modules: false,
            generated_code: false,
        })
    })
}
