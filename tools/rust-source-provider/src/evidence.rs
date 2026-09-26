use std::collections::HashMap;
use std::ops::ControlFlow;

use rustc_driver::{Callbacks, Compilation};
use rustc_hir::def::{DefKind, MacroKinds};
use rustc_hir::intravisit::{self, Visitor};
use rustc_interface::interface;
use rustc_middle::ty::TyCtxt;
use rustc_span::def_id::DefId;
use rustc_span::hygiene::{ExpnId, ExpnKind};
use rustc_span::Span;
use serde::Serialize;

use crate::request::{EvidencePhase, Limits, PROTOCOL_VERSION, Response, encode_response};
use crate::definitions::definition_kind;
use crate::inputs::{SourceInput, SourceProbe, TrackedInputs};
use crate::effects::{BodyEffects, TrackedEffects};
use crate::type_graph::TypeGraph;
use crate::type_model::{ConstantRow, Generics, TypeId, TypeRow};
use crate::scopes::{Scope, Visibility, collect_scope, visibility};

mod adjustments;
mod occurrences;
use occurrences::{BodyVisitor, Occurrence};

#[derive(Serialize)]
#[serde(tag = "phase", rename_all = "kebab-case")]
pub enum Evidence {
    Declarations {
        #[serde(flatten)]
        declarations: DeclarationEvidence,
    },
    Checked {
        #[serde(flatten)]
        declarations: DeclarationEvidence,
        occurrences: Vec<Occurrence>,
        effects: Vec<BodyEffects>,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeclarationEvidence {
    pub root: DefinitionId,
    pub items: Vec<DefinitionId>,
    pub inputs: Vec<SourceInput>,
    pub probes: Vec<SourceProbe>,
    pub types: Vec<TypeRow>,
    pub constants: Vec<ConstantRow>,
    pub expansions: Vec<Expansion>,
    pub definitions: Vec<Definition>,
    pub scopes: Vec<Scope>,
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
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Resolution {
    Declaration { id: DefinitionId },
    Binding { id: NodeId },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Definition {
    id: DefinitionId,
    stable: StableDefinitionId,
    parent: Option<DefinitionId>,
    path: String,
    name: Option<String>,
    kind: &'static str,
    macro_kinds: Vec<&'static str>,
    r#type: Option<TypeId>,
    generics: Option<Generics>,
    visibility: Option<Visibility>,
    source: Option<SourceSpan>,
}

#[derive(Serialize)]
pub struct StableDefinitionId {
    krate: String,
    path: String,
}

pub fn analyze(arguments: &[String], phase: EvidencePhase, limits: &Limits) -> Result<Vec<u8>, String> {
    let mut callbacks = EvidenceCallbacks {
        limits, phase, inputs: TrackedInputs::new(limits.maximum_rows),
        effects: TrackedEffects::new(limits.maximum_rows), result: None,
    };
    rustc_driver::catch_fatal_errors(|| rustc_driver::run_compiler(arguments, &mut callbacks))
        .map_err(|_| "Native compiler rejected the source; no semantic evidence was published.".to_owned())?;
    callbacks.result.ok_or_else(|| "Native compiler did not complete the requested semantic phase.".to_owned())?
}

struct EvidenceCallbacks<'limits> {
    limits: &'limits Limits,
    phase: EvidencePhase,
    inputs: TrackedInputs,
    effects: TrackedEffects,
    result: Option<Result<Vec<u8>, String>>,
}

impl Callbacks for EvidenceCallbacks<'_> {
    fn config(&mut self, configuration: &mut interface::Config) {
        configuration.file_loader = Some(Box::new(self.inputs.clone()));
        if self.phase == EvidencePhase::Checked {
            let effects = self.effects.clone();
            configuration.register_lints = Some(Box::new(move |_, store| {
                let effects = effects.clone();
                store.register_late_lint_pass(Box::new(move |_| Box::new(effects.pass())));
            }));
        }
    }

    fn after_expansion<'tcx>(
        &mut self,
        _compiler: &interface::Compiler,
        context: TyCtxt<'tcx>,
    ) -> Compilation {
        if self.phase == EvidencePhase::Declarations {
            self.capture(context);
            Compilation::Stop
        } else {
            Compilation::Continue
        }
    }

    fn after_analysis<'tcx>(
        &mut self,
        _compiler: &interface::Compiler,
        context: TyCtxt<'tcx>,
    ) -> Compilation {
        self.capture(context);
        Compilation::Stop
    }
}

impl EvidenceCallbacks<'_> {
    fn capture(&mut self, context: TyCtxt<'_>) {
        context.sess.dcx().abort_if_errors();
        self.result = Some((|| {
            let evidence = collect(context, self.phase, self.limits, &self.inputs, self.effects.take()?)?;
            context.sess.dcx().abort_if_errors();
            encode_response(&Response::Evidence { protocol_version: PROTOCOL_VERSION, evidence }, self.limits)
        })());
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

pub fn source_span(context: TyCtxt<'_>, span: Span) -> Option<SourceSpan> {
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
    phase: EvidencePhase,
    graph: TypeGraph<'tcx, 'limits>,
    occurrences: Vec<Occurrence>,
    expansions: HashMap<ExpnId, Expansion>,
    definitions: HashMap<DefId, Definition>,
    scopes: Vec<Scope>,
}

fn collect(context: TyCtxt<'_>, phase: EvidencePhase, limits: &Limits, tracked_inputs: &TrackedInputs,
    pending_effects: Vec<crate::effects::PendingBody>) -> Result<Evidence, String>
{
    let mut collector = Collector {
        context,
        phase,
        graph: TypeGraph::new(context, limits),
        occurrences: Vec::new(),
        expansions: HashMap::new(),
        definitions: HashMap::new(),
        scopes: Vec::new(),
    };
    let root = rustc_span::def_id::CRATE_DEF_ID.to_def_id();
    let mut items = Vec::new();
    for owner in context.hir_crate_items(()).definitions() {
        collector.graph.reserve(0)?;
        items.push(collector.graph.definition(owner.to_def_id())?);
    }
    if phase == EvidencePhase::Checked {
        for owner in context.hir_body_owners() {
            collector.graph.definition(owner.to_def_id())?;
            let mut visitor = BodyVisitor { collector: &mut collector, types: context.typeck(owner), depth: 0 };
            if let ControlFlow::Break(error) = visitor.visit_body(context.hir_body_owned_by(owner)) {
                return Err(error);
            }
        }
    }
    collector.graph.definition(root)?;
    let mut visitor = DefinitionVisitor { collector: &mut collector };
    if let ControlFlow::Break(error) = context.hir_visit_all_item_likes_in_crate(&mut visitor) {
        return Err(error);
    }
    let mut effects = Vec::new();
    for body in pending_effects {
        collector.graph.reserve(0)?;
        collector.graph.definition(body.owner.to_def_id())?;
        let mut accesses = Vec::new();
        for mut pending in body.accesses {
            collector.graph.reserve(0)?;
            for _ in &pending.access.projections { collector.graph.reserve(0)?; }
            collector.span_expansions(pending.span)?;
            pending.access.source = source_span(context, pending.span);
            accesses.push(pending.access);
        }
        effects.push(BodyEffects { owner: definition_id(body.owner.to_def_id()), accesses });
    }
    loop {
        collector.graph.expand()?;
        let definitions = collector.graph.take_definitions();
        if definitions.is_empty() { break; }
        for definition in definitions { collector.definition(definition)?; }
    }
    let snapshot = tracked_inputs.snapshot()?;
    let inputs = snapshot.files;
    let probes = snapshot.probes;
    for _ in &inputs { collector.graph.reserve(0)?; }
    for _ in &probes { collector.graph.reserve(0)?; }
    let (types, constants) = collector.graph.finish();
    let mut definitions = collector.definitions.into_values().collect::<Vec<_>>();
    definitions.sort_by_key(|entry| (entry.id.krate, entry.id.index));
    let mut expansions = collector.expansions.into_values().collect::<Vec<_>>();
    expansions.sort_by_key(|entry| (entry.id.krate, entry.id.index));
    let declarations = DeclarationEvidence { root: definition_id(root), items, inputs, probes, types,
        constants, expansions, definitions, scopes: collector.scopes };
    Ok(match phase {
        EvidencePhase::Declarations => Evidence::Declarations { declarations },
        EvidencePhase::Checked => Evidence::Checked { declarations, occurrences: collector.occurrences, effects },
    })
}

impl Collector<'_, '_> {
    fn definition(&mut self, id: DefId) -> Result<(), String> {
        if self.definitions.contains_key(&id) { return Ok(()); }
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
        let native_type = match kind {
            DefKind::Fn | DefKind::AssocFn | DefKind::Struct | DefKind::Enum | DefKind::Union
            | DefKind::TyAlias | DefKind::ForeignTy | DefKind::Field | DefKind::Const { .. }
            | DefKind::Static { .. } | DefKind::AssocConst { .. } | DefKind::Ctor(..) =>
                Some(self.context.type_of(id).instantiate_identity().skip_norm_wip()),
            DefKind::Closure if self.phase == EvidencePhase::Checked =>
                Some(self.context.type_of(id).instantiate_identity().skip_norm_wip()),
            _ => None,
        };
        self.context.sess.dcx().abort_if_errors();
        let ty = native_type.map(|value| self.graph.ty(value)).transpose()?;
        let generics = if kind.has_generics() { Some(self.graph.generics(id)?) } else { None };
        let visibility = match kind {
            DefKind::Mod | DefKind::Struct | DefKind::Union | DefKind::Enum | DefKind::Variant
            | DefKind::Trait | DefKind::TraitAlias | DefKind::TyAlias | DefKind::ForeignTy
            | DefKind::Fn | DefKind::Const { .. } | DefKind::Static { .. } | DefKind::Ctor(..)
            | DefKind::AssocFn | DefKind::AssocConst { .. } | DefKind::AssocTy | DefKind::Macro(_)
            | DefKind::Field => Some(visibility(&mut self.graph, self.context.visibility(id))?),
            _ => None,
        };
        self.context.sess.dcx().abort_if_errors();
        let stable = self.context.def_path_hash(id);
        self.definitions.insert(id, Definition {
            id: definition_id(id),
            stable: StableDefinitionId {
                krate: format!("{:016x}", stable.stable_crate_id().as_u64()),
                path: format!("{:016x}", stable.local_hash().as_u64()),
            },
            parent: self.context.opt_parent(id).map(definition_id),
            path: self.context.def_path_str(id),
            name: self.context.opt_item_name(id).map(|name| name.to_string()),
            kind: definition_kind(kind),
            macro_kinds,
            r#type: ty,
            generics,
            visibility,
            source: source_span(self.context, span),
        });
        if let Some(parent) = self.context.opt_parent(id) { self.graph.definition(parent)?; }
        if let Some(scope) = collect_scope(&mut self.graph, id)? {
            for span in scope.spans { self.span_expansions(span)?; }
            self.scopes.push(scope.value);
        }
        self.span_expansions(span)
    }

    fn span_expansions(&mut self, span: Span) -> Result<(), String> {
        for (id, _) in span.ctxt().marks() { self.expansion(id)?; }
        self.expansion(span.ctxt().outer_expn())
    }

    fn expansion(&mut self, mut id: ExpnId) -> Result<(), String> {
        while !self.expansions.contains_key(&id) {
            self.graph.reserve(0)?;
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
            if let Some(definition) = data.macro_def_id { self.graph.definition(definition)?; }
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
        if let Err(error) = self.collector.graph.definition(item.owner_id.to_def_id()) { return ControlFlow::Break(error); }
        intravisit::walk_item(self, item)
    }

    fn visit_trait_item(&mut self, item: &'tcx rustc_hir::TraitItem<'tcx>) -> Self::Result {
        if let Err(error) = self.collector.graph.definition(item.owner_id.to_def_id()) { return ControlFlow::Break(error); }
        intravisit::walk_trait_item(self, item)
    }

    fn visit_impl_item(&mut self, item: &'tcx rustc_hir::ImplItem<'tcx>) -> Self::Result {
        if let Err(error) = self.collector.graph.definition(item.owner_id.to_def_id()) { return ControlFlow::Break(error); }
        intravisit::walk_impl_item(self, item)
    }

    fn visit_foreign_item(&mut self, item: &'tcx rustc_hir::ForeignItem<'tcx>) -> Self::Result {
        if let Err(error) = self.collector.graph.definition(item.owner_id.to_def_id()) { return ControlFlow::Break(error); }
        intravisit::walk_foreign_item(self, item)
    }

    fn visit_field_def(&mut self, field: &'tcx rustc_hir::FieldDef<'tcx>) -> Self::Result {
        match self.collector.graph.definition(field.def_id.to_def_id()) {
            Ok(_) => ControlFlow::Continue(()),
            Err(error) => ControlFlow::Break(error),
        }
    }

    fn visit_variant(&mut self, variant: &'tcx rustc_hir::Variant<'tcx>) -> Self::Result {
        if let Err(error) = self.collector.graph.definition(variant.def_id.to_def_id()) {
            return ControlFlow::Break(error);
        }
        intravisit::walk_variant(self, variant)
    }

    fn visit_variant_data(&mut self, data: &'tcx rustc_hir::VariantData<'tcx>) -> Self::Result {
        if let Some(constructor) = data.ctor_def_id()
            && let Err(error) = self.collector.graph.definition(constructor.to_def_id())
        {
            return ControlFlow::Break(error);
        }
        intravisit::walk_struct_def(self, data)
    }
}
