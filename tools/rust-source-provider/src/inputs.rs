use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rustc_span::{SourceFileHash, SourceFileHashAlgorithm};
use rustc_span::source_map::{FileLoader, RealFileLoader};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceFile {
    pub path: String,
    pub text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInput {
    path: String,
    byte_length: usize,
    digest: String,
}

#[derive(Clone, Serialize)]
pub struct SourceProbe {
    path: String,
    exists: bool,
}

pub struct InputSnapshot {
    pub files: Vec<SourceInput>,
    pub probes: Vec<SourceProbe>,
}

#[derive(Default)]
struct InputState {
    files: BTreeMap<String, SourceInput>,
    probes: BTreeMap<String, SourceProbe>,
    failure: Option<String>,
}

#[derive(Clone)]
pub struct TrackedInputs {
    state: Arc<Mutex<InputState>>,
    sources: Arc<BTreeMap<String, String>>,
    maximum_files: usize,
}

impl TrackedInputs {
    pub fn new(maximum_files: usize, sources: Vec<SourceFile>) -> Result<Self, String> {
        if sources.len() > maximum_files { return Err("Native source inputs exceed the file limit.".to_owned()); }
        let mut selected = BTreeMap::new();
        for source in sources {
            if !Path::new(&source.path).is_absolute() || source.path.contains('\0') {
                return Err("Native source files require absolute Unicode paths without NUL.".to_owned());
            }
            if selected.insert(source.path, source.text).is_some() {
                return Err("Native source input has a duplicate filename.".to_owned());
            }
        }
        Ok(Self { state: Arc::default(), sources: Arc::new(selected), maximum_files })
    }

    pub fn snapshot(&self) -> Result<InputSnapshot, String> {
        let state = self.state.lock().map_err(|_| "Native source-input accounting failed.".to_owned())?;
        if let Some(error) = &state.failure { return Err(error.clone()); }
        Ok(InputSnapshot {
            files: state.files.values().cloned().collect(),
            probes: state.probes.values().cloned().collect(),
        })
    }

    fn record(&self, path: &Path, bytes: &[u8]) -> io::Result<()> {
        let path = absolute_path(path)?;
        let hash = SourceFileHash::new_in_memory(SourceFileHashAlgorithm::Sha256, bytes);
        let digest = hash.hash_bytes().iter().map(|byte| format!("{byte:02x}")).collect::<String>();
        let mut state = self.state.lock().map_err(|_| io::Error::other("Native source-input accounting failed."))?;
        if state.probes.get(&path).is_some_and(|probe| !probe.exists) {
            return Err(io::Error::other("A native source lookup changed during compilation."));
        }
        if let Some(previous) = state.files.get(&path) {
            if previous.digest != digest || previous.byte_length != bytes.len() {
                return Err(io::Error::other("A native source input changed during compilation."));
            }
        } else {
            if state.files.len() + state.probes.len() >= self.maximum_files {
                return Err(io::Error::other("Native source inputs exceed the file limit."));
            }
            state.files.insert(path.clone(), SourceInput { path, byte_length: bytes.len(), digest });
        }
        Ok(())
    }

    fn record_probe(&self, path: &Path, exists: bool) -> io::Result<()> {
        let path = absolute_path(path)?;
        let mut state = self.state.lock().map_err(|_| io::Error::other("Native source-input accounting failed."))?;
        if !exists && state.files.contains_key(&path) {
            return Err(io::Error::other("A native source lookup changed during compilation."));
        }
        if let Some(previous) = state.probes.get(&path) {
            if previous.exists != exists {
                return Err(io::Error::other("A native source lookup changed during compilation."));
            }
        } else {
            if state.files.len() + state.probes.len() >= self.maximum_files {
                return Err(io::Error::other("Native source inputs exceed the file limit."));
            }
            state.probes.insert(path.clone(), SourceProbe { path, exists });
        }
        Ok(())
    }

    fn remember_failure(&self, error: &io::Error) {
        if let Ok(mut state) = self.state.lock() {
            state.failure.get_or_insert_with(|| error.to_string());
        }
    }
}

fn absolute_path(path: &Path) -> io::Result<String> {
    let path = if path.is_absolute() { path.to_path_buf() } else { std::env::current_dir()?.join(path) };
    path.to_str().map(str::to_owned).ok_or_else(|| io::Error::other("Native source path is not valid UTF-8."))
}

impl FileLoader for TrackedInputs {
    fn file_exists(&self, path: &Path) -> bool {
        let absolute = match absolute_path(path) {
            Ok(path) => path,
            Err(error) => { self.remember_failure(&error); return false; }
        };
        let path = Path::new(&absolute);
        let exists = self.sources.contains_key(&absolute) || RealFileLoader.file_exists(path);
        if let Err(error) = self.record_probe(path, exists) { self.remember_failure(&error); }
        exists
    }

    fn read_file(&self, path: &Path) -> io::Result<String> {
        let absolute = absolute_path(path)?;
        let path = Path::new(&absolute);
        let text = match self.sources.get(&absolute) {
            Some(text) => text.clone(),
            None => RealFileLoader.read_file(path)?,
        };
        if let Err(error) = self.record(path, text.as_bytes()) {
            self.remember_failure(&error);
            return Err(error);
        }
        Ok(text)
    }

    fn read_binary_file(&self, path: &Path) -> io::Result<Arc<[u8]>> {
        let absolute = absolute_path(path)?;
        let path = Path::new(&absolute);
        let bytes = match self.sources.get(&absolute) {
            Some(text) => Arc::from(text.as_bytes()),
            None => RealFileLoader.read_binary_file(path)?,
        };
        if let Err(error) = self.record(path, &bytes) {
            self.remember_failure(&error);
            return Err(error);
        }
        Ok(bytes)
    }

    fn current_directory(&self) -> io::Result<PathBuf> { RealFileLoader.current_directory() }
}
