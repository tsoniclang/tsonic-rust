fn file_table() -> &'static Mutex<HashMap<i32, File>> {
    FILE_TABLE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn stats_from_metadata(metadata: &fs::Metadata) -> Stats {
    Stats {
        size: metadata.len(),
        dev: metadata_dev(metadata),
        ino: metadata_ino(metadata),
        mode: metadata_mode(metadata),
        nlink: metadata_nlink(metadata),
        uid: metadata_uid(metadata),
        gid: metadata_gid(metadata),
        rdev: metadata_rdev(metadata),
        blksize: metadata_blksize(metadata),
        blocks: metadata_blocks(metadata),
        atime_ms: system_time_ms(metadata.accessed().ok()),
        mtime_ms: system_time_ms(metadata.modified().ok()),
        ctime_ms: system_time_ms(metadata_changed(metadata)),
        birthtime_ms: system_time_ms(metadata.created().ok()),
        is_file: metadata.is_file(),
        is_directory: metadata.is_dir(),
        is_symbolic_link: metadata.file_type().is_symlink(),
        is_block_device: metadata_is_block_device(metadata),
        is_character_device: metadata_is_character_device(metadata),
        is_fifo: metadata_is_fifo(metadata),
        is_socket: metadata_is_socket(metadata),
    }
}

fn ms_to_ns(value: f64) -> u128 {
    if value.is_finite() && value > 0.0 {
        (value * 1_000_000.0).round() as u128
    } else {
        0
    }
}

fn system_time_ms(value: Option<SystemTime>) -> f64 {
    value
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

#[cfg(unix)]
fn metadata_dev(metadata: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.dev()
}

#[cfg(not(unix))]
fn metadata_dev(_metadata: &fs::Metadata) -> u64 {
    0
}

#[cfg(unix)]
fn metadata_ino(metadata: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.ino()
}

#[cfg(not(unix))]
fn metadata_ino(_metadata: &fs::Metadata) -> u64 {
    0
}

#[cfg(unix)]
fn metadata_mode(metadata: &fs::Metadata) -> u32 {
    use std::os::unix::fs::MetadataExt;
    metadata.mode()
}

#[cfg(not(unix))]
fn metadata_mode(metadata: &fs::Metadata) -> u32 {
    if metadata.permissions().readonly() {
        0o444
    } else {
        0o666
    }
}

#[cfg(unix)]
fn metadata_nlink(metadata: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.nlink()
}

#[cfg(not(unix))]
fn metadata_nlink(_metadata: &fs::Metadata) -> u64 {
    1
}

#[cfg(unix)]
fn metadata_uid(metadata: &fs::Metadata) -> u32 {
    use std::os::unix::fs::MetadataExt;
    metadata.uid()
}

#[cfg(not(unix))]
fn metadata_uid(_metadata: &fs::Metadata) -> u32 {
    0
}

#[cfg(unix)]
fn metadata_gid(metadata: &fs::Metadata) -> u32 {
    use std::os::unix::fs::MetadataExt;
    metadata.gid()
}

#[cfg(not(unix))]
fn metadata_gid(_metadata: &fs::Metadata) -> u32 {
    0
}

#[cfg(unix)]
fn metadata_rdev(metadata: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.rdev()
}

#[cfg(not(unix))]
fn metadata_rdev(_metadata: &fs::Metadata) -> u64 {
    0
}

#[cfg(unix)]
fn metadata_blksize(metadata: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.blksize()
}

#[cfg(not(unix))]
fn metadata_blksize(_metadata: &fs::Metadata) -> u64 {
    0
}

#[cfg(unix)]
fn metadata_blocks(metadata: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.blocks()
}

#[cfg(not(unix))]
fn metadata_blocks(_metadata: &fs::Metadata) -> u64 {
    0
}

#[cfg(unix)]
fn metadata_is_block_device(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::FileTypeExt;
    metadata.file_type().is_block_device()
}

#[cfg(not(unix))]
fn metadata_is_block_device(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
fn metadata_is_character_device(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::FileTypeExt;
    metadata.file_type().is_char_device()
}

#[cfg(not(unix))]
fn metadata_is_character_device(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
fn metadata_is_fifo(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::FileTypeExt;
    metadata.file_type().is_fifo()
}

#[cfg(not(unix))]
fn metadata_is_fifo(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
fn metadata_is_socket(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::FileTypeExt;
    metadata.file_type().is_socket()
}

#[cfg(not(unix))]
fn metadata_is_socket(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
fn metadata_changed(metadata: &fs::Metadata) -> Option<SystemTime> {
    use std::os::unix::fs::MetadataExt;
    let seconds = metadata.ctime();
    let nanos = metadata.ctime_nsec();
    if seconds < 0 {
        return None;
    }
    Some(UNIX_EPOCH + std::time::Duration::new(seconds as u64, nanos as u32))
}

#[cfg(not(unix))]
fn metadata_changed(metadata: &fs::Metadata) -> Option<SystemTime> {
    metadata.modified().ok()
}
