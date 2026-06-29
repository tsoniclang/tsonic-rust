use super::{
    finished_with_options as finished_sync_with_options, pipeline as pipeline_sync,
    FinishedOptions, Readable, Writable,
};
use crate::buffer::Buffer;
use crate::error::{NodeError, NodeResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PipelineOptions {
    pub end: bool,
    pub signal_aborted: bool,
}

impl Default for PipelineOptions {
    fn default() -> Self {
        Self {
            end: true,
            signal_aborted: false,
        }
    }
}

pub fn pipeline(readable: &mut Readable, writable: &mut Writable) -> NodeResult<()> {
    pipeline_sync(readable, writable)
}

pub fn pipeline_with_options(
    readable: &mut Readable,
    writable: &mut Writable,
    options: &PipelineOptions,
) -> NodeResult<usize> {
    pipeline_transforms(readable, &[], writable, options)
}

pub fn pipeline_transform(
    readable: &mut Readable,
    transform: impl FnMut(Buffer) -> Buffer,
    writable: &mut Writable,
    options: &PipelineOptions,
) -> NodeResult<usize> {
    pipeline_transform_impl(readable, transform, writable, options)
}

pub fn pipeline_transforms(
    readable: &mut Readable,
    transforms: &[fn(Buffer) -> Buffer],
    writable: &mut Writable,
    options: &PipelineOptions,
) -> NodeResult<usize> {
    pipeline_transform_impl(
        readable,
        |mut chunk| {
            for transform in transforms {
                chunk = transform(chunk);
            }
            chunk
        },
        writable,
        options,
    )
}

pub fn finished(readable: &Readable, writable: &Writable) -> bool {
    super::finished(readable, writable)
}

pub fn finished_with_options(
    readable: &Readable,
    writable: &Writable,
    options: &FinishedOptions,
) -> bool {
    finished_sync_with_options(readable, writable, options)
}

fn pipeline_transform_impl(
    readable: &mut Readable,
    mut transform: impl FnMut(Buffer) -> Buffer,
    writable: &mut Writable,
    options: &PipelineOptions,
) -> NodeResult<usize> {
    if options.signal_aborted {
        return Err(NodeError::new("ABORT_ERR", "pipeline aborted"));
    }

    let mut written = 0;
    while let Some(chunk) = readable.read() {
        if !writable.write(transform(chunk)) {
            written += 1;
            break;
        }
        written += 1;
    }
    if options.end {
        writable.end();
    }
    Ok(written)
}
