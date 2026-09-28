use std::io::{self, Write};

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAXIMUM_REQUEST_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    Tokens {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        edition: String,
        source: String,
        limits: Limits,
    },
    Analyze {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        phase: EvidencePhase,
        compilation: CompilationInput,
        limits: Limits,
    },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum CompilationInput {
    Compiler { directory: String, arguments: Vec<String> },
    Cargo {
        #[serde(rename = "manifestPath")]
        manifest_path: String,
        #[serde(rename = "packageId")]
        package_id: String,
        target: CargoTarget,
        #[serde(rename = "compilerIdentity")]
        compiler_identity: String,
        sysroot: String,
        #[serde(rename = "targetDirectory")]
        target_directory: String,
    },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum CargoTarget {
    Library,
    Binary { name: String },
}

#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EvidencePhase {
    Declarations,
    Typed,
    Checked,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Limits {
    pub maximum_rows: usize,
    pub maximum_depth: usize,
    pub maximum_output_bytes: usize,
}

impl Request {
    pub fn limits(&self) -> &Limits {
        match self {
            Self::Tokens { limits, .. } | Self::Analyze { limits, .. } => limits,
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        let version = match self {
            Self::Tokens { protocol_version, .. } | Self::Analyze { protocol_version, .. } => *protocol_version,
        };
        if version != PROTOCOL_VERSION {
            return Err("Native source protocol version mismatch.".to_owned());
        }
        let limits = self.limits();
        if limits.maximum_rows == 0 || limits.maximum_rows > 4_194_304
            || limits.maximum_depth == 0 || limits.maximum_depth > 512
            || limits.maximum_output_bytes == 0 || limits.maximum_output_bytes > 256 * 1024 * 1024
        {
            return Err("Native source limits must be positive and within the service ceilings.".to_owned());
        }
        if let Self::Analyze { compilation, .. } = self {
            let input_rows = match compilation {
                CompilationInput::Compiler { directory, arguments } => {
                    if !std::path::Path::new(directory).is_absolute() || directory.contains('\0') {
                        return Err("Native compiler directory must be absolute and cannot contain NUL.".to_owned());
                    }
                    if arguments.is_empty() || arguments.iter().any(|argument| argument.contains('\0')) {
                        return Err("Native compiler arguments must be nonempty and cannot contain NUL.".to_owned());
                    }
                    arguments.len() + 1
                }
                CompilationInput::Cargo { manifest_path, package_id, target, compiler_identity, sysroot, target_directory } => {
                    for path in [manifest_path, sysroot, target_directory] {
                        if !std::path::Path::new(path).is_absolute() || path.contains('\0') {
                            return Err("Native Cargo paths must be absolute and cannot contain NUL.".to_owned());
                        }
                    }
                    if compiler_identity.is_empty() || compiler_identity.contains('\0') {
                        return Err("Native Cargo checking requires its selected compiler identity.".to_owned());
                    }
                    if package_id.is_empty() || package_id.contains('\0') {
                        return Err("Native Cargo checking requires an exact root package selection.".to_owned());
                    }
                    if let CargoTarget::Binary { name } = target {
                        if name.is_empty() || name.contains('\0') {
                            return Err("Native Cargo checking requires an exact binary target name.".to_owned());
                        }
                    }
                    3
                }
            };
            if input_rows > limits.maximum_rows {
                return Err("Native source inputs exceed the row limit.".to_owned());
            }
        }
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Response {
    Tokens {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        tokens: Vec<crate::tokens::Token>,
    },
    Evidence {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        evidence: crate::evidence::Evidence,
    },
}

pub fn encode_response(response: &Response, limits: &Limits) -> Result<Vec<u8>, String> {
    let mut output = BoundedBuffer::new(limits.maximum_output_bytes);
    serde_json::to_writer(&mut output, response).map_err(|error| error.to_string())?;
    Ok(output.bytes)
}

pub struct Budget<'limits> {
    limits: &'limits Limits,
    rows: usize,
}

impl<'limits> Budget<'limits> {
    pub fn new(limits: &'limits Limits) -> Self {
        Self { limits, rows: 0 }
    }

    pub fn reserve(&mut self, depth: usize) -> Result<(), String> {
        if depth > self.limits.maximum_depth {
            return Err("Native source nesting exceeds the depth limit.".to_owned());
        }
        if self.rows == self.limits.maximum_rows {
            return Err("Native source evidence exceeds the row limit.".to_owned());
        }
        self.rows += 1;
        Ok(())
    }
}

pub struct BoundedBuffer {
    pub bytes: Vec<u8>,
    maximum: usize,
}

impl BoundedBuffer {
    pub fn new(maximum: usize) -> Self {
        Self { bytes: Vec::new(), maximum }
    }
}

impl Write for BoundedBuffer {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.maximum - self.bytes.len() {
            return Err(io::Error::other("Native source evidence exceeds the output byte limit."));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
