fn errno_constants() -> BTreeMap<&'static str, i32> {
    BTreeMap::from([
        ("E2BIG", libc::E2BIG),
        ("EACCES", libc::EACCES),
        ("EADDRINUSE", libc::EADDRINUSE),
        ("EADDRNOTAVAIL", libc::EADDRNOTAVAIL),
        ("EAFNOSUPPORT", libc::EAFNOSUPPORT),
        ("EALREADY", libc::EALREADY),
        ("EAGAIN", libc::EAGAIN),
        ("EBADMSG", errno_or_zero("EBADMSG")),
        ("EBADF", libc::EBADF),
        ("EBUSY", libc::EBUSY),
        ("ECANCELED", libc::ECANCELED),
        ("ECHILD", libc::ECHILD),
        ("ECONNABORTED", libc::ECONNABORTED),
        ("ECONNREFUSED", libc::ECONNREFUSED),
        ("ECONNRESET", libc::ECONNRESET),
        ("EDEADLK", libc::EDEADLK),
        ("EDESTADDRREQ", libc::EDESTADDRREQ),
        ("EDQUOT", errno_or_zero("EDQUOT")),
        ("EDOM", libc::EDOM),
        ("EEXIST", libc::EEXIST),
        ("EFAULT", libc::EFAULT),
        ("EFBIG", libc::EFBIG),
        ("EHOSTUNREACH", libc::EHOSTUNREACH),
        ("EIDRM", libc::EIDRM),
        ("EILSEQ", libc::EILSEQ),
        ("EINPROGRESS", libc::EINPROGRESS),
        ("EINTR", libc::EINTR),
        ("EINVAL", libc::EINVAL),
        ("EIO", libc::EIO),
        ("EISDIR", libc::EISDIR),
        ("EISCONN", libc::EISCONN),
        ("ELOOP", libc::ELOOP),
        ("EMFILE", libc::EMFILE),
        ("EMLINK", libc::EMLINK),
        ("EMSGSIZE", libc::EMSGSIZE),
        ("EMULTIHOP", errno_or_zero("EMULTIHOP")),
        ("ENAMETOOLONG", libc::ENAMETOOLONG),
        ("ENETDOWN", libc::ENETDOWN),
        ("ENETRESET", libc::ENETRESET),
        ("ENETUNREACH", libc::ENETUNREACH),
        ("ENFILE", libc::ENFILE),
        ("ENOBUFS", libc::ENOBUFS),
        ("ENODATA", errno_or_zero("ENODATA")),
        ("ENODEV", libc::ENODEV),
        ("ENOENT", libc::ENOENT),
        ("ENOEXEC", libc::ENOEXEC),
        ("ENOLCK", libc::ENOLCK),
        ("ENOLINK", errno_or_zero("ENOLINK")),
        ("ENOMEM", libc::ENOMEM),
        ("ENOMSG", libc::ENOMSG),
        ("ENOPROTOOPT", libc::ENOPROTOOPT),
        ("ENOSPC", libc::ENOSPC),
        ("ENOSR", errno_or_zero("ENOSR")),
        ("ENOSTR", errno_or_zero("ENOSTR")),
        ("ENOSYS", libc::ENOSYS),
        ("ENOTDIR", libc::ENOTDIR),
        ("ENOTEMPTY", libc::ENOTEMPTY),
        ("ENOTCONN", libc::ENOTCONN),
        ("ENOTSOCK", libc::ENOTSOCK),
        ("ENOTSUP", libc::ENOTSUP),
        ("ENOTTY", libc::ENOTTY),
        ("ENXIO", libc::ENXIO),
        ("EOPNOTSUPP", libc::EOPNOTSUPP),
        ("EOVERFLOW", libc::EOVERFLOW),
        ("EPERM", libc::EPERM),
        ("EPIPE", libc::EPIPE),
        ("EPROTO", libc::EPROTO),
        ("EPROTONOSUPPORT", libc::EPROTONOSUPPORT),
        ("EPROTOTYPE", libc::EPROTOTYPE),
        ("ERANGE", libc::ERANGE),
        ("EROFS", libc::EROFS),
        ("ESPIPE", libc::ESPIPE),
        ("ESRCH", libc::ESRCH),
        ("ESTALE", errno_or_zero("ESTALE")),
        ("ETIMEDOUT", libc::ETIMEDOUT),
        ("ETXTBSY", errno_or_zero("ETXTBSY")),
        ("EWOULDBLOCK", libc::EWOULDBLOCK),
        ("EXDEV", libc::EXDEV),
        ("WSAEACCES", libc::EACCES),
        ("WSAEADDRINUSE", libc::EADDRINUSE),
        ("WSAEADDRNOTAVAIL", libc::EADDRNOTAVAIL),
        ("WSAEAFNOSUPPORT", libc::EAFNOSUPPORT),
        ("WSAEALREADY", libc::EALREADY),
        ("WSAEBADF", libc::EBADF),
        ("WSAECANCELLED", 0),
        ("WSAECONNABORTED", libc::ECONNABORTED),
        ("WSAECONNREFUSED", libc::ECONNREFUSED),
        ("WSAECONNRESET", libc::ECONNRESET),
        ("WSAEDESTADDRREQ", libc::EDESTADDRREQ),
        ("WSAEDISCON", 0),
        ("WSAEDQUOT", errno_or_zero("EDQUOT")),
        ("WSAEFAULT", libc::EFAULT),
        ("WSAEHOSTDOWN", 0),
        ("WSAEHOSTUNREACH", libc::EHOSTUNREACH),
        ("WSAEINPROGRESS", libc::EINPROGRESS),
        ("WSAEINTR", libc::EINTR),
        ("WSAEINVAL", libc::EINVAL),
        ("WSAEINVALIDPROCTABLE", 0),
        ("WSAEINVALIDPROVIDER", 0),
        ("WSAEISCONN", libc::EISCONN),
        ("WSAELOOP", libc::ELOOP),
        ("WSAEMFILE", libc::EMFILE),
        ("WSAEMSGSIZE", libc::EMSGSIZE),
        ("WSAENAMETOOLONG", libc::ENAMETOOLONG),
        ("WSAENETDOWN", libc::ENETDOWN),
        ("WSAENETRESET", libc::ENETRESET),
        ("WSAENETUNREACH", libc::ENETUNREACH),
        ("WSAENOBUFS", libc::ENOBUFS),
        ("WSAENOMORE", 0),
        ("WSAENOPROTOOPT", libc::ENOPROTOOPT),
        ("WSAENOTCONN", libc::ENOTCONN),
        ("WSAENOTEMPTY", libc::ENOTEMPTY),
        ("WSAENOTSOCK", libc::ENOTSOCK),
        ("WSAEOPNOTSUPP", libc::EOPNOTSUPP),
        ("WSAEPFNOSUPPORT", 0),
        ("WSAEPROCLIM", 0),
        ("WSAEPROVIDERFAILEDINIT", 0),
        ("WSAEPROTONOSUPPORT", libc::EPROTONOSUPPORT),
        ("WSAEPROTOTYPE", libc::EPROTOTYPE),
        ("WSAEREFUSED", 0),
        ("WSAEREMOTE", 0),
        ("WSAESHUTDOWN", 0),
        ("WSAESOCKTNOSUPPORT", 0),
        ("WSAETIMEDOUT", libc::ETIMEDOUT),
        ("WSAETOOMANYREFS", 0),
        ("WSAEUSERS", 0),
        ("WSAEWOULDBLOCK", libc::EWOULDBLOCK),
        ("WSANOTINITIALISED", 0),
        ("WSASERVICE_NOT_FOUND", 0),
        ("WSASYSCALLFAILURE", 0),
        ("WSASYSNOTREADY", 0),
        ("WSATYPE_NOT_FOUND", 0),
        ("WSAVERNOTSUPPORTED", 0),
        ("WSA_E_CANCELLED", 0),
        ("WSA_E_NO_MORE", 0),
    ])
}

fn errno_or_zero(_name: &str) -> i32 {
    0
}

#[cfg(unix)]
fn signal_constants() -> BTreeMap<&'static str, i32> {
    BTreeMap::from([
        ("SIGABRT", libc::SIGABRT),
        ("SIGALRM", libc::SIGALRM),
        ("SIGBUS", libc::SIGBUS),
        ("SIGCHLD", libc::SIGCHLD),
        ("SIGCONT", libc::SIGCONT),
        ("SIGFPE", libc::SIGFPE),
        ("SIGHUP", libc::SIGHUP),
        ("SIGILL", libc::SIGILL),
        ("SIGINT", libc::SIGINT),
        ("SIGKILL", libc::SIGKILL),
        ("SIGPIPE", libc::SIGPIPE),
        ("SIGQUIT", libc::SIGQUIT),
        ("SIGSEGV", libc::SIGSEGV),
        ("SIGSTOP", libc::SIGSTOP),
        ("SIGTERM", libc::SIGTERM),
        ("SIGTRAP", libc::SIGTRAP),
        ("SIGTSTP", libc::SIGTSTP),
        ("SIGTTIN", libc::SIGTTIN),
        ("SIGTTOU", libc::SIGTTOU),
        ("SIGUSR1", libc::SIGUSR1),
        ("SIGUSR2", libc::SIGUSR2),
    ])
}

#[cfg(not(unix))]
fn signal_constants() -> BTreeMap<&'static str, i32> {
    BTreeMap::new()
}

#[cfg(unix)]
fn dlopen_constants() -> BTreeMap<&'static str, i32> {
    BTreeMap::from([
        ("RTLD_LAZY", libc::RTLD_LAZY),
        ("RTLD_NOW", libc::RTLD_NOW),
        ("RTLD_GLOBAL", libc::RTLD_GLOBAL),
        ("RTLD_LOCAL", libc::RTLD_LOCAL),
        ("RTLD_DEEPBIND", rtld_deepbind_constant()),
    ])
}

#[cfg(not(unix))]
fn dlopen_constants() -> BTreeMap<&'static str, i32> {
    BTreeMap::new()
}

#[cfg(target_os = "linux")]
fn rtld_deepbind_constant() -> i32 {
    libc::RTLD_DEEPBIND
}

#[cfg(not(target_os = "linux"))]
fn rtld_deepbind_constant() -> i32 {
    0
}

#[cfg(target_os = "linux")]
fn meminfo_kb(key: &str) -> Option<u64> {
    let meminfo = std::fs::read_to_string("/proc/meminfo").ok()?;
    for line in meminfo.lines() {
        let (name, rest) = line.split_once(':')?;
        if name != key {
            continue;
        }
        return rest.split_whitespace().next()?.parse::<u64>().ok();
    }
    None
}

#[cfg(not(target_os = "linux"))]
fn meminfo_kb(_key: &str) -> Option<u64> {
    None
}

#[cfg(target_os = "linux")]
fn cpuinfo() -> Option<Vec<CpuInfo>> {
    let text = std::fs::read_to_string("/proc/cpuinfo").ok()?;
    let mut values = Vec::new();
    let mut model = None::<String>;
    let mut speed = None::<u32>;

    for line in text.lines().chain(std::iter::once("")) {
        if line.trim().is_empty() {
            if model.is_some() || speed.is_some() {
                values.push(CpuInfo {
                    model: model
                        .take()
                        .unwrap_or_else(|| std::env::consts::ARCH.to_string()),
                    speed: speed.take().unwrap_or(0),
                    times: CpuTimes::default(),
                });
            }
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        match key {
            "model name" | "Processor" | "Hardware" if model.is_none() => {
                model = Some(value.to_string());
            }
            "cpu MHz" if speed.is_none() => {
                speed = value
                    .parse::<f64>()
                    .ok()
                    .map(|value| value.round().max(0.0) as u32);
            }
            _ => {}
        }
    }

    if values.is_empty() {
        None
    } else {
        Some(values)
    }
}

#[cfg(not(target_os = "linux"))]
fn cpuinfo() -> Option<Vec<CpuInfo>> {
    None
}
