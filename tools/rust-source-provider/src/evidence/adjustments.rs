use rustc_ast::{BindingMode as NativeBindingMode, ByRef, Pinnedness};
use rustc_middle::ty::adjustment::{
    Adjust, AllowTwoPhase, AutoBorrow, AutoBorrowMutability, DerefAdjustKind,
    PatAdjust, PointerCoercion,
};
use serde::Serialize;

use crate::evidence::DefinitionId;
use crate::type_graph::TypeGraph;
use crate::type_model::TypeId;

#[derive(Serialize)]
pub struct Adjustment {
    pub target: TypeId,
    pub operation: Operation,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Operation {
    NeverToAny,
    BuiltinDeref,
    OverloadedDeref { mutable: bool, method: DefinitionId },
    PinDeref,
    BorrowReference { mutable: bool, #[serde(rename = "twoPhase")] two_phase: bool },
    BorrowRawPointer { mutable: bool },
    BorrowPin { mutable: bool },
    ReifyFunctionPointer { #[serde(rename = "unsafe")] unsafe_: bool },
    UnsafeFunctionPointer,
    ClosureFunctionPointer { #[serde(rename = "unsafe")] unsafe_: bool },
    MutableToConstPointer,
    ArrayToPointer,
    Unsize,
    GenericReborrow { mutable: bool },
}

#[derive(Serialize)]
pub struct PatternAdjustment {
    pub source: TypeId,
    pub kind: &'static str,
}

#[derive(Serialize)]
pub struct BindingMode {
    pub mutable: bool,
    pub reference: Option<ReferenceBinding>,
}

#[derive(Serialize)]
pub struct ReferenceBinding {
    pub mutable: bool,
    pub pinned: bool,
}

impl<'tcx> TypeGraph<'tcx, '_> {
    pub fn adjustment(&mut self, value: &rustc_middle::ty::adjustment::Adjustment<'tcx>)
        -> Result<Adjustment, String>
    {
        self.reserve(0)?;
        let operation = match value.kind {
            Adjust::NeverToAny => Operation::NeverToAny,
            Adjust::Deref(DerefAdjustKind::Builtin) => Operation::BuiltinDeref,
            Adjust::Deref(DerefAdjustKind::Pin) => Operation::PinDeref,
            Adjust::Deref(DerefAdjustKind::Overloaded(value)) => Operation::OverloadedDeref {
                mutable: value.mutbl.is_mut(), method: self.definition(value.method_call(self.context))?,
            },
            Adjust::Borrow(AutoBorrow::Ref(mutability)) => match mutability {
                AutoBorrowMutability::Not => Operation::BorrowReference { mutable: false, two_phase: false },
                AutoBorrowMutability::Mut { allow_two_phase_borrow } => Operation::BorrowReference {
                    mutable: true, two_phase: allow_two_phase_borrow == AllowTwoPhase::Yes,
                },
            },
            Adjust::Borrow(AutoBorrow::RawPtr(mutability)) => Operation::BorrowRawPointer { mutable: mutability.is_mut() },
            Adjust::Borrow(AutoBorrow::Pin(mutability)) => Operation::BorrowPin { mutable: mutability.is_mut() },
            Adjust::Pointer(PointerCoercion::ReifyFnPointer(safety)) => Operation::ReifyFunctionPointer { unsafe_: safety.is_unsafe() },
            Adjust::Pointer(PointerCoercion::UnsafeFnPointer) => Operation::UnsafeFunctionPointer,
            Adjust::Pointer(PointerCoercion::ClosureFnPointer(safety)) => Operation::ClosureFunctionPointer { unsafe_: safety.is_unsafe() },
            Adjust::Pointer(PointerCoercion::MutToConstPointer) => Operation::MutableToConstPointer,
            Adjust::Pointer(PointerCoercion::ArrayToPointer) => Operation::ArrayToPointer,
            Adjust::Pointer(PointerCoercion::Unsize) => Operation::Unsize,
            Adjust::GenericReborrow(mutability) => Operation::GenericReborrow { mutable: mutability.is_mut() },
        };
        Ok(Adjustment { target: self.ty(value.target)?, operation })
    }

    pub fn pattern_adjustment(&mut self, value: &rustc_middle::ty::adjustment::PatAdjustment<'tcx>)
        -> Result<PatternAdjustment, String>
    {
        self.reserve(0)?;
        Ok(PatternAdjustment { source: self.ty(value.source)?, kind: match value.kind {
            PatAdjust::BuiltinDeref => "builtin-deref",
            PatAdjust::OverloadedDeref => "overloaded-deref",
            PatAdjust::PinDeref => "pin-deref",
        } })
    }

    pub fn binding_mode(&mut self, mode: NativeBindingMode) -> Result<BindingMode, String> {
        self.reserve(0)?;
        let reference = match mode.0 {
            ByRef::No => None,
            ByRef::Yes(pinnedness, mutability) => {
                self.reserve(0)?;
                Some(ReferenceBinding { mutable: mutability.is_mut(), pinned: pinnedness == Pinnedness::Pinned })
            }
        };
        Ok(BindingMode { mutable: mode.1.is_mut(), reference })
    }
}
