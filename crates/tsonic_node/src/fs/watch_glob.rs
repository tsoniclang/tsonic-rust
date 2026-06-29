pub fn glob_sync(pattern: &str) -> NodeResult<Vec<String>> {
    let mut matches = glob::glob(pattern)
        .map_err(|error| NodeError::new("ERR_INVALID_ARG_VALUE", error.to_string()))?
        .map(|entry| {
            entry
                .map(|path| path.to_string_lossy().to_string())
                .map_err(|error| NodeError::new("EIO", error.to_string()))
        })
        .collect::<NodeResult<Vec<_>>>()?;
    matches.sort();
    Ok(matches)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FsWatchEvent {
    pub event_type: String,
    pub filename: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FsWatcher {
    path: String,
    previous: Option<WatchSnapshot>,
    closed: bool,
    refed: bool,
}

impl FsWatcher {
    pub fn poll(&mut self) -> NodeResult<Option<FsWatchEvent>> {
        if self.closed {
            return Err(NodeError::new("ERR_WATCHER_CLOSED", "watcher is closed"));
        }
        let next = WatchSnapshot::read(&self.path);
        let event_type = match (&self.previous, &next) {
            (None, None) => None,
            (None, Some(_)) => Some("rename"),
            (Some(_), None) => Some("rename"),
            (Some(previous), Some(next)) if previous != next => Some("change"),
            _ => None,
        };
        self.previous = next;
        Ok(event_type.map(|event_type| FsWatchEvent {
            event_type: event_type.to_string(),
            filename: std::path::Path::new(&self.path)
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| self.path.clone()),
        }))
    }

    pub fn close(&mut self) {
        self.closed = true;
    }

    pub fn ref_(&mut self) -> &mut Self {
        self.refed = true;
        self
    }

    pub fn unref(&mut self) -> &mut Self {
        self.refed = false;
        self
    }

    pub fn has_ref(&self) -> bool {
        self.refed
    }

    pub fn closed(&self) -> bool {
        self.closed
    }
}

pub fn watch(path: &str) -> NodeResult<FsWatcher> {
    watch_with_options(path, WatchOptions::default())
}

pub fn watch_with_options(path: &str, options: WatchOptions) -> NodeResult<FsWatcher> {
    if options.signal_aborted {
        return Err(NodeError::new("ABORT_ERR", "watch was aborted"));
    }
    Ok(FsWatcher {
        path: path.to_string(),
        previous: WatchSnapshot::read(path),
        closed: false,
        refed: options.persistent,
    })
}

pub fn watch_file(path: &str) -> NodeResult<FsWatcher> {
    watch(path)
}

pub fn watch_file_with_options(path: &str, options: WatchFileOptions) -> NodeResult<FsWatcher> {
    let mut watcher = watch(path)?;
    watcher.refed = options.persistent;
    Ok(watcher)
}

pub type StatWatcher = FsWatcher;

#[derive(Debug, Clone, PartialEq, Eq)]
struct WatchSnapshot {
    len: u64,
    is_file: bool,
    is_directory: bool,
}

impl WatchSnapshot {
    fn read(path: &str) -> Option<Self> {
        let metadata = fs::metadata(path).ok()?;
        Some(Self {
            len: metadata.len(),
            is_file: metadata.is_file(),
            is_directory: metadata.is_dir(),
        })
    }
}

static NEXT_FD: AtomicI32 = AtomicI32::new(10);
static FILE_TABLE: OnceLock<Mutex<HashMap<i32, File>>> = OnceLock::new();

