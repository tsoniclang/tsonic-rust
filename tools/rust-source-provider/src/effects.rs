use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use rustc_hir::{Body, HirId};
use rustc_hir_typeck::expr_use_visitor::{Delegate, ExprUseVisitor};
use rustc_lint::{LateContext, LateLintPass};
use rustc_middle::hir::place::{PlaceBase, PlaceWithHirId, ProjectionKind};
use rustc_middle::mir::FakeReadCause;
use rustc_middle::ty::BorrowKind;
use rustc_span::Span;
use rustc_span::def_id::LocalDefId;
use serde::Serialize;

use crate::evidence::{DefinitionId, NodeId, SourceSpan, definition_id, node_id};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BodyEffects {
    pub owner: DefinitionId,
    pub accesses: Vec<Access>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Access {
    pub kind: &'static str,
    pub place: NodeId,
    pub diagnostic: NodeId,
    pub source: Option<SourceSpan>,
    pub base: Base,
    pub projections: Vec<Projection>,
    pub fake_read: Option<FakeRead>,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Base {
    Temporary,
    Static,
    Local { binding: NodeId },
    Capture { binding: NodeId, closure: DefinitionId },
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Projection {
    Dereference,
    Field { field: usize, variant: usize },
    Index,
    Subslice,
    OpaqueCast,
    UnwrapUnsafeBinder,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FakeRead {
    pub reason: &'static str,
    pub closure: Option<DefinitionId>,
}

pub struct PendingBody {
    pub owner: LocalDefId,
    pub accesses: Vec<PendingAccess>,
}

pub struct PendingAccess {
    pub span: Span,
    pub access: Access,
}

#[derive(Clone)]
pub struct TrackedEffects {
    maximum_rows: usize,
    rows: Arc<AtomicUsize>,
    bodies: Arc<Mutex<Vec<PendingBody>>>,
}

impl TrackedEffects {
    pub fn new(maximum_rows: usize) -> Self {
        Self { maximum_rows, rows: Arc::new(AtomicUsize::new(0)), bodies: Arc::default() }
    }

    pub fn pass(&self) -> NativeUsePass {
        NativeUsePass { effects: self.clone() }
    }

    pub fn take(&self) -> Result<Vec<PendingBody>, String> {
        if self.rows.load(Ordering::Relaxed) > self.maximum_rows {
            return Err("Native source effects exceed the row limit.".to_owned());
        }
        let mut bodies = self.bodies.lock().map_err(|_| "Native source effect collector failed.")?;
        bodies.sort_by_key(|body| body.owner.local_def_index.as_u32());
        Ok(std::mem::take(&mut bodies))
    }
}

pub struct NativeUsePass {
    effects: TrackedEffects,
}

rustc_session::impl_lint_pass!(NativeUsePass => []);

impl<'tcx> LateLintPass<'tcx> for NativeUsePass {
    fn check_body(&mut self, context: &LateContext<'tcx>, body: &Body<'tcx>) {
        let owner = context.tcx.hir_body_owner_def_id(body.id());
        let mut delegate = UseCollector { context, effects: &self.effects, accesses: Vec::new() };
        ExprUseVisitor::for_clippy(context, owner, &mut delegate)
            .consume_body(body).unwrap_or_else(|never| match never {});
        if let Ok(mut bodies) = self.effects.bodies.lock() {
            bodies.push(PendingBody { owner, accesses: delegate.accesses });
        }
    }
}

struct UseCollector<'context, 'tcx> {
    context: &'context LateContext<'tcx>,
    effects: &'context TrackedEffects,
    accesses: Vec<PendingAccess>,
}

impl<'tcx> UseCollector<'_, 'tcx> {
    fn record(&mut self, kind: &'static str, place: &PlaceWithHirId<'tcx>, diagnostic: HirId,
        fake_read: Option<FakeRead>)
    {
        let count = 1 + place.place.projections.len();
        if self.effects.rows.fetch_add(count, Ordering::Relaxed)
            .saturating_add(count) > self.effects.maximum_rows { return; }
        let base = match place.place.base {
            PlaceBase::Rvalue => Base::Temporary,
            PlaceBase::StaticItem => Base::Static,
            PlaceBase::Local(binding) => Base::Local { binding: node_id(binding) },
            PlaceBase::Upvar(capture) => Base::Capture {
                binding: node_id(capture.var_path.hir_id),
                closure: definition_id(capture.closure_expr_id.to_def_id()),
            },
        };
        let projections = place.place.projections.iter().map(|projection| match projection.kind {
            ProjectionKind::Deref => Projection::Dereference,
            ProjectionKind::Field(field, variant) => Projection::Field {
                field: field.as_usize(), variant: variant.as_usize(),
            },
            ProjectionKind::Index => Projection::Index,
            ProjectionKind::Subslice => Projection::Subslice,
            ProjectionKind::OpaqueCast => Projection::OpaqueCast,
            ProjectionKind::UnwrapUnsafeBinder => Projection::UnwrapUnsafeBinder,
        }).collect();
        self.accesses.push(PendingAccess { span: self.context.tcx.hir_span(diagnostic), access: Access {
            kind, place: node_id(place.hir_id), diagnostic: node_id(diagnostic), source: None,
            base, projections, fake_read,
        } });
    }
}

impl<'tcx> Delegate<'tcx> for UseCollector<'_, 'tcx> {
    fn consume(&mut self, place: &PlaceWithHirId<'tcx>, diagnostic: HirId) {
        self.record("move", place, diagnostic, None);
    }

    fn use_cloned(&mut self, place: &PlaceWithHirId<'tcx>, diagnostic: HirId) {
        self.record("use-cloned", place, diagnostic, None);
    }

    fn copy(&mut self, place: &PlaceWithHirId<'tcx>, diagnostic: HirId) {
        self.record("copy", place, diagnostic, None);
    }

    fn borrow(&mut self, place: &PlaceWithHirId<'tcx>, diagnostic: HirId, kind: BorrowKind) {
        self.record(match kind {
            BorrowKind::Immutable => "borrow-shared",
            BorrowKind::UniqueImmutable => "borrow-unique-shared",
            BorrowKind::Mutable => "borrow-mutable",
        }, place, diagnostic, None);
    }

    fn mutate(&mut self, place: &PlaceWithHirId<'tcx>, diagnostic: HirId) {
        self.record("mutate", place, diagnostic, None);
    }

    fn bind(&mut self, place: &PlaceWithHirId<'tcx>, diagnostic: HirId) {
        self.record("bind", place, diagnostic, None);
    }

    fn fake_read(&mut self, place: &PlaceWithHirId<'tcx>, cause: FakeReadCause, diagnostic: HirId) {
        let (reason, closure) = match cause {
            FakeReadCause::ForMatchGuard => ("match-guard", None),
            FakeReadCause::ForMatchedPlace(closure) => ("matched-place", closure),
            FakeReadCause::ForGuardBinding => ("guard-binding", None),
            FakeReadCause::ForLet(closure) => ("let", closure),
            FakeReadCause::ForIndex => ("index", None),
        };
        self.record("fake-read", place, diagnostic, Some(FakeRead {
            reason, closure: closure.map(|id| definition_id(id.to_def_id())),
        }));
    }
}
