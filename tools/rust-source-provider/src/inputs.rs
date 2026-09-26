use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rustc_span::{SourceFileHash, SourceFileHashAlgorithm};
use rustc_span::source_map::{FileLoader, RealFileLoader};
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInput {
    path: String,
    byte_length: usize,
    digest: String,
}

#[derive(Clone)]
pub struct TrackedInputs {
    entries: Arc<Mutex<BTreeMap<String, SourceInput>>>,
    maximum_files: usize,
}

impl TrackedInputs {
    pub fn new(maximum_files: usize) -> Self {
        Self { entries: Arc::new(Mutex::new(BTreeMap::new())), maximum_files }
    }

    pub fn snapshot(&self) -> Result<Vec<SourceInput>, String> {
        self.entries.lock().map_err(|_| "Native source-input accounting failed.".to_owned())
            .map(|entries| entries.values().cloned().collect())
    }

    fn record(&self, path: &Path, bytes: &[u8]) -> io::Result<()> {
        let path = if path.is_absolute() { path.to_path_buf() } else { std::env::current_dir()?.join(path) };
        let path = path.to_str().ok_or_else(|| io::Error::other("Native source path is not valid UTF-8."))?.to_owned();
        let hash = SourceFileHash::new_in_memory(SourceFileHashAlgorithm::Sha256, bytes);
        let digest = hash.hash_bytes().iter().map(|byte| format!("{byte:02x}")).collect::<String>();
        let mut entries = self.entries.lock().map_err(|_| io::Error::other("Native source-input accounting failed."))?;
        if let Some(previous) = entries.get(&path) {
            if previous.digest != digest || previous.byte_length != bytes.len() {
                return Err(io::Error::other("A native source input changed during compilation."));
            }
        } else {
            if entries.len() >= self.maximum_files {
                return Err(io::Error::other("Native source inputs exceed the file limit."));
            }
            entries.insert(path.clone(), SourceInput { path, byte_length: bytes.len(), digest });
        }
        Ok(())
    }
}

impl FileLoader for TrackedInputs {
    fn file_exists(&self, path: &Path) -> bool { RealFileLoader.file_exists(path) }

    fn read_file(&self, path: &Path) -> io::Result<String> {
        let text = RealFileLoader.read_file(path)?;
        self.record(path, text.as_bytes())?;
        Ok(text)
    }

    fn read_binary_file(&self, path: &Path) -> io::Result<Arc<[u8]>> {
        let bytes = RealFileLoader.read_binary_file(path)?;
        self.record(path, &bytes)?;
        Ok(bytes)
    }

    fn current_directory(&self) -> io::Result<PathBuf> { RealFileLoader.current_directory() }
}
