use std::collections::{HashMap, HashSet};
use std::ops::ControlFlow;

use rustc_driver::{Callbacks, Compilation};
use rustc_hir::def::{DefKind, MacroKinds, Res};
use rustc_hir::intravisit::{self, Visitor};
use rustc_interface::interface;
use rustc_middle::ty::{TyCtxt, TypeckResults};
use rustc_public::rustc_internal::{internal, run, stable};
use rustc_public::crate_def::CrateDef;
use rustc_public::ty::{Generics, PolyFnSig, Ty, TyKind};
use rustc_public::visitor::{Visitable, Visitor as TypeVisitor};
use rustc_span::def_id::DefId;
use rustc_span::hygiene::{ExpnId, ExpnKind};
use rustc_span::Span;
use serde::Serialize;

use crate::request::{Budget, Limits, PROTOCOL_VERSION, Response, encode_response};
use crate::definitions::definition_kind;
use crate::inputs::{SourceInput, TrackedInputs};
use crate::effects::{BodyEffects, TrackedEffects};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub inputs: Vec<SourceInput>,
    pub occurrences: Vec<Occurrence>,
    pub types: Vec<TypeRow>,
    pub expansions: Vec<Expansion>,
    pub definitions: Vec<Definition>,
    pub effects: Vec<BodyEffects>,
}

#[derive(Clone, Copy, Serialize)]
pub struct DefinitionId {
    krate: u32,
    index: u32,
}

#[derive(Serialize)]
pub struct NodeId {
    owner: DefinitionId,
    local: u32,
}

#[derive(Serialize)]
pub struct SourceSpan {
    file: String,
    start: u32,
    end: u32,
    context: Vec<HygieneMark>,
    expansion: ExpansionId,
}

#[derive(Serialize)]
pub struct HygieneMark {
    expansion: ExpansionId,
    transparency: &'static str,
}

#[derive(Clone, Copy, Serialize)]
pub struct ExpansionId {
    krate: u32,
    index: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Expansion {
    id: ExpansionId,
    parent: ExpansionId,
    kind: &'static str,
    name: String,
    definition: Option<DefinitionId>,
    call_site: Option<SourceSpan>,
    definition_site: Option<SourceSpan>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Occurrence {
    id: NodeId,
    kind: &'static str,
    source: Option<SourceSpan>,
    r#type: Ty,
    adjusted_type: Ty,
    resolution: Option<Resolution>,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Resolution {
    Declaration { id: DefinitionId },
    Binding { id: NodeId },
}

#[derive(Serialize)]
pub struct TypeRow {
    id: Ty,
    kind: TyKind,
    signature: Option<PolyFnSig>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Definition {
    id: DefinitionId,
    public_id: rustc_public::DefId,
    parent: Option<DefinitionId>,
    path: String,
    name: Option<String>,
    kind: &'static str,
    macro_kinds: Vec<&'static str>,
    r#type: Option<Ty>,
    generics: Option<Generics>,
    source: Option<SourceSpan>,
}

pub fn check(arguments: &[String], limits: &Limits) -> Result<Vec<u8>, String> {
    let mut callbacks = EvidenceCallbacks {
        limits, inputs: TrackedInputs::new(limits.maximum_rows),
        effects: TrackedEffects::new(limits.maximum_rows), result: None,
    };
    rustc_driver::catch_fatal_errors(|| rustc_driver::run_compiler(arguments, &mut callbacks))
        .map_err(|_| "Native compiler rejected the source; no semantic evidence was published.".to_owned())?;
    callbacks.result.ok_or_else(|| "Native compiler did not complete semantic analysis.".to_owned())?
}

struct EvidenceCallbacks<'limits> {
    limits: &'limits Limits,
    inputs: TrackedInputs,
    effects: TrackedEffects,
    result: Option<Result<Vec<u8>, String>>,
}

impl Callbacks for EvidenceCallbacks<'_> {
    fn config(&mut self, configuration: &mut interface::Config) {
        configuration.file_loader = Some(Box::new(self.inputs.clone()));
        let effects = self.effects.clone();
        configuration.register_lints = Some(Box::new(move |_, store| {
            let effects = effects.clone();
            store.register_late_lint_pass(Box::new(move |_| Box::new(effects.pass())));
        }));
    }

    fn after_analysis<'tcx>(
        &mut self,
        _compiler: &interface::Compiler,
        context: TyCtxt<'tcx>,
    ) -> Compilation {
        self.result = Some(run(context, || {
            let evidence = collect(context, self.limits, self.inputs.snapshot()?, self.effects.take()?)?;
            encode_response(&Response::Evidence { protocol_version: PROTOCOL_VERSION, evidence }, self.limits)
        })
            .map_err(|error| format!("Native compiler evidence context failed: {error}"))
            .and_then(|result| result));
        Compilation::Stop
    }
}

pub fn definition_id(id: DefId) -> DefinitionId {
    DefinitionId { krate: id.krate.as_u32(), index: id.index.as_u32() }
}

pub fn node_id(id: rustc_hir::HirId) -> NodeId {
    NodeId { owner: definition_id(id.owner.to_def_id()), local: id.local_id.as_u32() }
}

fn expansion_id(id: ExpnId) -> ExpansionId {
    ExpansionId { krate: id.krate.as_u32(), index: id.local_id.as_u32() }
}

fn source_span(context: TyCtxt<'_>, span: Span) -> Option<SourceSpan> {
    if span.is_dummy() { return None; }
    let start = context.sess.source_map().lookup_byte_offset(span.lo());
    Some(SourceSpan {
        file: start.sf.name.prefer_local_unconditionally().to_string(),
        start: start.sf.original_relative_byte_pos(span.lo()).0,
        end: start.sf.original_relative_byte_pos(span.hi()).0,
        context: span.ctxt().marks().into_iter().map(|(expansion, transparency)| HygieneMark {
            expansion: expansion_id(expansion),
            transparency: match transparency {
                rustc_span::hygiene::Transparency::Opaque => "opaque",
                rustc_span::hygiene::Transparency::SemiOpaque => "semi-opaque",
                rustc_span::hygiene::Transparency::Transparent => "transparent",
            },
        }).collect(),
        expansion: expansion_id(span.ctxt().outer_expn()),
    })
}

struct Collector<'tcx, 'limits> {
    context: TyCtxt<'tcx>,
    budget: Budget<'limits>,
    occurrences: Vec<Occurrence>,
    type_queue: Vec<Ty>,
    type_set: HashSet<Ty>,
    expansions: HashMap<ExpnId, Expansion>,
    definitions: HashMap<DefId, Definition>,
}

fn collect(context: TyCtxt<'_>, limits: &Limits, inputs: Vec<SourceInput>,
    pending_effects: Vec<crate::effects::PendingBody>) -> Result<Evidence, String>
{
    let mut collector = Collector {
        context,
        budget: Budget::new(limits),
        occurrences: Vec::new(),
        type_queue: Vec::new(),
        type_set: HashSet::new(),
        expansions: HashMap::new(),
        definitions: HashMap::new(),
    };
    for _ in &inputs { collector.budget.reserve(0)?; }
    for owner in context.hir_body_owners() {
        collector.definition(owner.to_def_id())?;
        let mut visitor = BodyVisitor { collector: &mut collector, types: context.typeck(owner), depth: 0 };
        if let ControlFlow::Break(error) = visitor.visit_body(context.hir_body_owned_by(owner)) {
            return Err(error);
        }
    }
    collector.definition(rustc_span::def_id::CRATE_DEF_ID.to_def_id())?;
    let mut visitor = DefinitionVisitor { collector: &mut collector };
    if let ControlFlow::Break(error) = context.hir_visit_all_item_likes_in_crate(&mut visitor) {
        return Err(error);
    }
    let mut types = Vec::new();
    let mut index = 0;
    while index < collector.type_queue.len() {
        let id = collector.type_queue[index];
        let kind = id.kind();
        let native_type: rustc_middle::ty::Ty<'_> = internal(context, id);
        let definition = match native_type.kind() {
            rustc_middle::ty::Adt(definition, _) => Some(definition.did()),
            rustc_middle::ty::Foreign(id) | rustc_middle::ty::FnDef(id, _)
            | rustc_middle::ty::Closure(id, _) | rustc_middle::ty::Coroutine(id, _)
            | rustc_middle::ty::CoroutineWitness(id, _) | rustc_middle::ty::CoroutineClosure(id, _) => Some(*id),
            _ => None,
        };
        if let Some(definition) = definition { collector.definition(definition)?; }
        if let TyKind::Alias(_, alias) = &kind { collector.definition(internal(context, alias.def_id.def_id()))?; }
        let signature = kind.fn_sig();
        if let ControlFlow::Break(error) = id.super_visit(&mut collector) { return Err(error); }
        if let Some(signature) = &signature
            && let ControlFlow::Break(error) = signature.visit(&mut collector)
        { return Err(error); }
        types.push(TypeRow { id, kind, signature });
        index += 1;
    }
    let mut effects = Vec::new();
    for body in pending_effects {
        collector.budget.reserve(0)?;
        collector.definition(body.owner.to_def_id())?;
        let mut accesses = Vec::new();
        for mut pending in body.accesses {
            collector.budget.reserve(0)?;
            for _ in &pending.access.projections { collector.budget.reserve(0)?; }
            collector.span_expansions(pending.span)?;
            pending.access.source = source_span(context, pending.span);
            accesses.push(pending.access);
        }
        effects.push(BodyEffects { owner: definition_id(body.owner.to_def_id()), accesses });
    }
    let mut definitions = collector.definitions.into_values().collect::<Vec<_>>();
    definitions.sort_by_key(|entry| (entry.id.krate, entry.id.index));
    let mut expansions = collector.expansions.into_values().collect::<Vec<_>>();
    expansions.sort_by_key(|entry| (entry.id.krate, entry.id.index));
    Ok(Evidence { inputs, occurrences: collector.occurrences, types, expansions, definitions, effects })
}

impl Collector<'_, '_> {
    fn register_type(&mut self, ty: Ty) -> Result<(), String> {
        if self.type_set.insert(ty) {
            self.budget.reserve(0)?;
            self.type_queue.push(ty);
        }
        Ok(())
    }

    fn definition(&mut self, id: DefId) -> Result<(), String> {
        if self.definitions.contains_key(&id) { return Ok(()); }
        self.budget.reserve(0)?;
        let span = self.context.def_span(id);
        let kind = self.context.def_kind(id);
        let macro_kinds = match kind {
            DefKind::Macro(kinds) => [
                (MacroKinds::BANG, "function-like"),
                (MacroKinds::ATTR, "attribute"),
                (MacroKinds::DERIVE, "derive"),
            ].into_iter().filter_map(|(flag, name)| kinds.contains(flag).then_some(name)).collect(),
            _ => Vec::new(),
        };
        let ty = match kind {
            DefKind::Fn | DefKind::AssocFn | DefKind::Struct | DefKind::Enum | DefKind::Union
            | DefKind::TyAlias | DefKind::ForeignTy | DefKind::Field | DefKind::Const { .. }
            | DefKind::Static { .. } | DefKind::AssocConst { .. } | DefKind::Ctor(..)
            | DefKind::Closure => Some(stable(self.context.type_of(id).instantiate_identity().skip_norm_wip())),
            _ => None,
        };
        if let Some(ty) = ty { self.register_type(ty)?; }
        self.definitions.insert(id, Definition {
            id: definition_id(id),
            public_id: stable(id),
            parent: self.context.opt_parent(id).map(definition_id),
            path: self.context.def_path_str(id),
            name: self.context.opt_item_name(id).map(|name| name.to_string()),
            kind: definition_kind(kind),
            macro_kinds,
            r#type: ty,
            generics: kind.has_generics().then(|| stable(self.context.generics_of(id))),
            source: source_span(self.context, span),
        });
        if let Some(parent) = self.context.opt_parent(id) { self.definition(parent)?; }
        self.span_expansions(span)
    }

    fn span_expansions(&mut self, span: Span) -> Result<(), String> {
        for (id, _) in span.ctxt().marks() { self.expansion(id)?; }
        self.expansion(span.ctxt().outer_expn())
    }

    fn expansion(&mut self, mut id: ExpnId) -> Result<(), String> {
        while !self.expansions.contains_key(&id) {
            self.budget.reserve(0)?;
            let data = id.expn_data();
            let kind = match data.kind {
                ExpnKind::Root => "root",
                ExpnKind::Macro(rustc_span::hygiene::MacroKind::Bang, _) => "function-like",
                ExpnKind::Macro(rustc_span::hygiene::MacroKind::Attr, _) => "attribute",
                ExpnKind::Macro(rustc_span::hygiene::MacroKind::Derive, _) => "derive",
                ExpnKind::AstPass(_) => "compiler-pass",
                ExpnKind::Desugaring(_) => "desugaring",
            };
            self.expansions.insert(id, Expansion {
                id: expansion_id(id), parent: expansion_id(data.parent), kind,
                name: data.kind.descr(),
                definition: data.macro_def_id.map(definition_id),
                call_site: source_span(self.context, data.call_site),
                definition_site: source_span(self.context, data.def_site),
            });
            if let Some(definition) = data.macro_def_id { self.definition(definition)?; }
            self.span_expansions(data.call_site)?;
            self.span_expansions(data.def_site)?;
            id = data.parent;
        }
        Ok(())
    }
}

struct DefinitionVisitor<'collector, 'tcx, 'limits> {
    collector: &'collector mut Collector<'tcx, 'limits>,
}

impl<'tcx> Visitor<'tcx> for DefinitionVisitor<'_, 'tcx, '_> {
    type Result = ControlFlow<String>;

    fn visit_item(&mut self, item: &'tcx rustc_hir::Item<'tcx>) -> Self::Result {
        if let Err(error) = self.collector.definition(item.owner_id.to_def_id()) { return ControlFlow::Break(error); }
        intravisit::walk_item(self, item)
    }

    fn visit_trait_item(&mut self, item: &'tcx rustc_hir::TraitItem<'tcx>) -> Self::Result {
        if let Err(error) = self.collector.definition(item.owner_id.to_def_id()) { return ControlFlow::Break(error); }
        intravisit::walk_trait_item(self, item)
    }

    fn visit_impl_item(&mut self, item: &'tcx rustc_hir::ImplItem<'tcx>) -> Self::Result {
        if let Err(error) = self.collector.definition(item.owner_id.to_def_id()) { return ControlFlow::Break(error); }
        intravisit::walk_impl_item(self, item)
    }

    fn visit_foreign_item(&mut self, item: &'tcx rustc_hir::ForeignItem<'tcx>) -> Self::Result {
        if let Err(error) = self.collector.definition(item.owner_id.to_def_id()) { return ControlFlow::Break(error); }
        intravisit::walk_foreign_item(self, item)
    }

    fn visit_field_def(&mut self, field: &'tcx rustc_hir::FieldDef<'tcx>) -> Self::Result {
        match self.collector.definition(field.def_id.to_def_id()) {
            Ok(()) => ControlFlow::Continue(()),
            Err(error) => ControlFlow::Break(error),
        }
    }
}

impl TypeVisitor for Collector<'_, '_> {
    type Break = String;

    fn visit_ty(&mut self, ty: &Ty) -> ControlFlow<String> {
        match self.register_type(*ty) {
            Ok(()) => ControlFlow::Continue(()),
            Err(error) => ControlFlow::Break(error),
        }
    }
}

struct BodyVisitor<'collector, 'tcx, 'limits> {
    collector: &'collector mut Collector<'tcx, 'limits>,
    types: &'tcx TypeckResults<'tcx>,
    depth: usize,
}

impl<'tcx> Visitor<'tcx> for BodyVisitor<'_, 'tcx, '_> {
    type Result = ControlFlow<String>;

    fn visit_expr(&mut self, expression: &'tcx rustc_hir::Expr<'tcx>) -> Self::Result {
        let selected_definition = match expression.kind {
            rustc_hir::ExprKind::Path(ref path) => self.types.qpath_res(path, expression.hir_id).opt_def_id(),
            _ => self.types.type_dependent_def_id(expression.hir_id),
        };
        if let Some(definition) = selected_definition
            && let Err(error) = self.collector.definition(definition)
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
        self.record(expression.hir_id, expression.span, "expression", self.types.expr_ty(expression),
            self.types.expr_ty_adjusted(expression), resolution)?;
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
        self.record(pattern.hir_id, pattern.span, "pattern", self.types.pat_ty(pattern),
            self.types.pat_ty(pattern), resolution)?;
        self.depth += 1;
        let result = intravisit::walk_pat(self, pattern);
        self.depth -= 1;
        result
    }
}

impl<'tcx> BodyVisitor<'_, 'tcx, '_> {
    fn record(&mut self, id: rustc_hir::HirId, span: Span, kind: &'static str,
        ty: rustc_middle::ty::Ty<'tcx>, adjusted: rustc_middle::ty::Ty<'tcx>,
        resolution: Option<Resolution>) -> ControlFlow<String>
    {
        let result = (|| {
            self.collector.budget.reserve(self.depth)?;
            self.collector.span_expansions(span)?;
            let ty = stable(ty);
            let adjusted = stable(adjusted);
            self.collector.register_type(ty)?;
            self.collector.register_type(adjusted)?;
            self.collector.occurrences.push(Occurrence {
                id: node_id(id), kind, source: source_span(self.collector.context, span),
                r#type: ty, adjusted_type: adjusted, resolution,
            });
            Ok(())
        })();
        match result {
            Ok(()) => ControlFlow::Continue(()),
            Err(error) => ControlFlow::Break(error),
        }
    }
}
