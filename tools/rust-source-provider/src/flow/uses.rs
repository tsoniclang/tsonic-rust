use rustc_middle::mir::{Place, ProjectionElem};
use rustc_middle::mir::visit::{MutatingUseContext, NonMutatingUseContext, NonUseContext, PlaceContext};

use super::model::{Access, Projection};

pub fn access(place: Place<'_>, context: PlaceContext, reserve: &mut impl FnMut() -> Result<(), String>) -> Result<Access, String> {
    reserve()?;
    let projections = place.projection.iter().map(|projection| {
        reserve()?;
        Ok(match projection {
            ProjectionElem::Deref => Projection::Dereference,
            ProjectionElem::Field(field, _) => Projection::Field { field: field.as_usize() },
            ProjectionElem::Index(local) => Projection::Index { local: local.as_usize() },
            ProjectionElem::ConstantIndex { offset, min_length, from_end } => Projection::ConstantIndex {
                offset: offset.to_string(), minimum_length: min_length.to_string(), from_end,
            },
            ProjectionElem::Subslice { from, to, from_end } => Projection::Subslice { from: from.to_string(), to: to.to_string(), from_end },
            ProjectionElem::Downcast(_, variant) => Projection::Downcast { variant: variant.as_usize() },
            ProjectionElem::OpaqueCast(_) => Projection::OpaqueCast,
            ProjectionElem::UnwrapUnsafeBinder(_) => Projection::UnwrapUnsafeBinder,
        })
    }).collect::<Result<_, String>>()?;
    let kind = match context {
        PlaceContext::NonMutatingUse(value) => match value {
            NonMutatingUseContext::Inspect => "inspect",
            NonMutatingUseContext::Copy => "copy",
            NonMutatingUseContext::Move => "move",
            NonMutatingUseContext::SharedBorrow => "borrow-shared",
            NonMutatingUseContext::FakeBorrow => "borrow-fake",
            NonMutatingUseContext::RawBorrow => "address-shared",
            NonMutatingUseContext::PlaceMention => "place-mention",
            NonMutatingUseContext::Projection => "projection-read",
        },
        PlaceContext::MutatingUse(value) => match value {
            MutatingUseContext::Store => "store",
            MutatingUseContext::SetDiscriminant => "set-discriminant",
            MutatingUseContext::AsmOutput => "assembly-output",
            MutatingUseContext::Call => "call-result",
            MutatingUseContext::Yield => "yield-result",
            MutatingUseContext::Drop => "drop",
            MutatingUseContext::Borrow => "borrow-mutable",
            MutatingUseContext::RawBorrow => "address-mutable",
            MutatingUseContext::Projection => "projection-write",
            MutatingUseContext::Retag => "retag",
        },
        PlaceContext::NonUse(value) => match value {
            NonUseContext::StorageLive => "storage-live",
            NonUseContext::StorageDead => "storage-dead",
            NonUseContext::AscribeUserTy(_) => "ascribe-type",
            NonUseContext::VarDebugInfo => "debug-info",
            NonUseContext::BackwardIncompatibleDropHint => "drop-hint",
        },
    };
    Ok(Access { kind, local: place.local.as_usize(), projections })
}
