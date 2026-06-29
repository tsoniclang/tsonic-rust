#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dir {
    pub path: String,
    entries: Vec<Dirent>,
    index: usize,
    closed: bool,
}

impl Dir {
    pub fn open(path: &str) -> NodeResult<Self> {
        Ok(Self {
            path: path.to_string(),
            entries: opendir_sync(path)?,
            index: 0,
            closed: false,
        })
    }

    pub fn read_sync(&mut self) -> Option<Dirent> {
        if self.closed {
            return None;
        }
        let entry = self.entries.get(self.index).cloned();
        if entry.is_some() {
            self.index += 1;
        }
        entry
    }

    pub fn read(&mut self) -> NodeResult<Option<Dirent>> {
        Ok(self.read_sync())
    }

    pub fn read_callback(&mut self, callback: impl FnOnce(NodeResult<Option<Dirent>>)) {
        callback(self.read());
    }

    pub fn close_sync(&mut self) {
        self.closed = true;
    }

    pub fn close(&mut self) -> NodeResult<()> {
        self.close_sync();
        Ok(())
    }

    pub fn close_callback(&mut self, callback: impl FnOnce(NodeResult<()>)) {
        callback(self.close());
    }

    pub fn closed(&self) -> bool {
        self.closed
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisposableTempDir {
    pub path: String,
}

impl DisposableTempDir {
    pub fn new(path: String) -> Self {
        Self { path }
    }

    pub fn remove(&self) -> NodeResult<()> {
        rm_sync(&self.path, true, true)
    }
}

