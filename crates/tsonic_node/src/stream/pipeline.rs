pub fn pipeline(readable: &mut Readable, writable: &mut Writable) -> NodeResult<()> {
    while let Some(chunk) = readable.read() {
        if !writable.write(chunk) {
            break;
        }
    }
    writable.end();
    Ok(())
}

pub fn finished(readable: &Readable, writable: &Writable) -> bool {
    readable.is_ended() && writable.is_ended()
}

pub fn finished_with_options(
    readable: &Readable,
    writable: &Writable,
    options: &FinishedOptions,
) -> bool {
    if options.error && (readable.errored().is_some() || writable.errored().is_some()) {
        return false;
    }
    if options.readable && !readable.is_ended() {
        return false;
    }
    if options.writable && !writable.is_ended() {
        return false;
    }
    true
}

pub fn is_readable(readable: &Readable) -> bool {
    readable.readable()
}

pub fn is_writable(writable: &Writable) -> bool {
    writable.writable()
}

pub fn is_errored(readable: &Readable, writable: &Writable) -> bool {
    readable.errored().is_some() || writable.errored().is_some()
}

pub fn is_destroyed(readable: &Readable, writable: &Writable) -> bool {
    readable.destroyed() || writable.destroyed()
}

pub fn compose(readable: Readable, next: impl Fn(Readable) -> Readable) -> Readable {
    readable.compose(next)
}

pub fn add_abort_signal(readable: &mut Readable, signal_aborted: bool) {
    if signal_aborted {
        readable.destroy_with_error("aborted");
    }
}

