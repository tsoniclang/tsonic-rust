use std::ops::ControlFlow;

use rustc_hir::def::Res;
use rustc_hir::intravisit::{self, Visitor};
use rustc_middle::ty::TypeckResults;
use rustc_span::Span;
use serde::Serialize;

use super::{Collector, NodeId, Resolution, SourceSpan, definition_id, node_id, source_span};
use super::adjustments::{Adjustment, BindingMode, PatternAdjustment};
use crate::type_model::{Argument, TypeId};

#[derive(Serialize)]
pub(crate) struct Occurrence {
    id: NodeId,
    source: Option<SourceSpan>,
    r#type: TypeId,
    resolution: Option<Resolution>,
    #[serde(flatten)]
    detail: Detail,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum Detail {
    Expression {
        #[serde(rename = "adjustedType")]
        adjusted_type: TypeId,
        arguments: Option<Vec<Argument>>,
        adjustments: Vec<Adjustment>,
    },
    Pattern {
        adjustments: Vec<PatternAdjustment>,
        binding: Option<BindingMode>,
    },
}

pub(super) struct BodyVisitor<'collector, 'tcx, 'limits> {
    pub collector: &'collector mut Collector<'tcx, 'limits>,
    pub types: &'tcx TypeckResults<'tcx>,
    pub depth: usize,
}

impl<'tcx> Visitor<'tcx> for BodyVisitor<'_, 'tcx, '_> {
    type Result = ControlFlow<String>;

    fn visit_expr(&mut self, expression: &'tcx rustc_hir::Expr<'tcx>) -> Self::Result {
        let selected_definition = match expression.kind {
            rustc_hir::ExprKind::Path(ref path) => self.types.qpath_res(path, expression.hir_id).opt_def_id(),
            _ => self.types.type_dependent_def_id(expression.hir_id),
        };
        if let Some(definition) = selected_definition
            && let Err(error) = self.collector.graph.definition(definition)
        { return ControlFlow::Break(error); }
        let resolution = match expression.kind {
            rustc_hir::ExprKind::Path(ref path) => match self.types.qpath_res(path, expression.hir_id) {
                Res::Def(_, definition) => Some(Resolution::Declaration { id: definition_id(definition) }),
                Res::Local(binding) => Some(Resolution::Binding { id: node_id(binding) }),
                _ => None,
            },
            _ => self.types.type_dependent_def_id(expression.hir_id)
                .map(|id| Resolution::Declaration { id: definition_id(id) }),
        };
        let detail = (|| {
            let arguments = self.types.node_args_opt(expression.hir_id)
                .map(|arguments| self.collector.graph.arguments(arguments)).transpose()?;
            let adjustments = self.types.expr_adjustments(expression).iter()
                .map(|adjustment| self.collector.graph.adjustment(adjustment)).collect::<Result<_, _>>()?;
            Ok::<_, String>(Detail::Expression {
                arguments, adjustments, adjusted_type: self.collector.graph.ty(self.types.expr_ty_adjusted(expression))?,
            })
        })();
        let detail = match detail { Ok(value) => value, Err(error) => return ControlFlow::Break(error) };
        self.record(expression.hir_id, expression.span, self.types.expr_ty(expression), resolution, detail)?;
        self.depth += 1;
        let result = intravisit::walk_expr(self, expression);
        self.depth -= 1;
        result
    }

    fn visit_pat(&mut self, pattern: &'tcx rustc_hir::Pat<'tcx>) -> Self::Result {
        let resolution = match pattern.kind {
            rustc_hir::PatKind::Binding(_, binding, _, _) => Some(Resolution::Binding { id: node_id(binding) }),
            _ => None,
        };
        let detail = (|| {
            let binding = match pattern.kind {
                rustc_hir::PatKind::Binding(..) => Some(self.collector.graph.binding_mode(
                    *self.types.pat_binding_modes().get(pattern.hir_id)
                        .ok_or("A checked native binding has no binding-mode evidence.")?)?),
                _ => None,
            };
            let adjustments = self.types.pat_adjustments().get(pattern.hir_id).into_iter().flatten()
                .map(|adjustment| self.collector.graph.pattern_adjustment(adjustment)).collect::<Result<_, _>>()?;
            Ok::<_, String>(Detail::Pattern { binding, adjustments })
        })();
        let detail = match detail { Ok(value) => value, Err(error) => return ControlFlow::Break(error) };
        self.record(pattern.hir_id, pattern.span, self.types.pat_ty(pattern), resolution, detail)?;
        self.depth += 1;
        let result = intravisit::walk_pat(self, pattern);
        self.depth -= 1;
        result
    }
}

impl<'tcx> BodyVisitor<'_, 'tcx, '_> {
    fn record(&mut self, id: rustc_hir::HirId, span: Span, ty: rustc_middle::ty::Ty<'tcx>,
        resolution: Option<Resolution>, detail: Detail) -> ControlFlow<String>
    {
        let result = (|| {
            self.collector.graph.reserve(self.depth)?;
            self.collector.span_expansions(span)?;
            let ty = self.collector.graph.ty(ty)?;
            self.collector.occurrences.push(Occurrence {
                id: node_id(id), source: source_span(self.collector.context, span), r#type: ty, resolution, detail,
            });
            Ok(())
        })();
        match result {
            Ok(()) => ControlFlow::Continue(()),
            Err(error) => ControlFlow::Break(error),
        }
    }
}
