use rustc_hir::def::{DefKind, Namespace, NonMacroAttrKind, Res};
use rustc_middle::metadata::{ModChild, Reexport};
use rustc_middle::ty;
use rustc_span::{Span, def_id::DefId};
use serde::Serialize;

use crate::evidence::{DefinitionId, SourceSpan, definition_id, source_span};
use crate::type_graph::TypeGraph;
use crate::type_model::{Argument, TypeId};

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Visibility {
    Public,
    Restricted { module: DefinitionId },
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum BindingResolution {
    Declaration { definition: DefinitionId },
    Primitive { name: String },
    SelfParameter { definition: DefinitionId },
    SelfAlias { definition: DefinitionId, #[serde(rename = "traitImplementation")] trait_implementation: bool },
    SelfConstructor { definition: DefinitionId },
    ToolModule,
    OpenModule { name: String },
    BuiltinAttribute { name: String },
    ToolAttribute,
    DeriveHelper,
    ForwardDeriveHelper,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ReexportStep {
    Single { definition: DefinitionId },
    Glob { definition: DefinitionId },
    ExternCrate { definition: DefinitionId },
    MacroUse,
    MacroExport,
}

#[derive(Serialize)]
pub struct Binding {
    name: String,
    namespace: &'static str,
    source: Option<SourceSpan>,
    visibility: Visibility,
    resolution: BindingResolution,
    reexports: Vec<ReexportStep>,
}

#[derive(Serialize)]
pub struct Ambiguity { main: Binding, second: Binding }

#[derive(Serialize)]
pub struct TraitImplementation {
    definition: DefinitionId,
    arguments: Vec<Argument>,
    polarity: &'static str,
    safety: &'static str,
    constness: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssociatedMember {
    definition: DefinitionId,
    trait_member: Option<DefinitionId>,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Scope {
    Named { owner: DefinitionId, bindings: Vec<Binding>, ambiguities: Vec<Ambiguity> },
    Implementation {
        owner: DefinitionId,
        #[serde(rename = "selfType")]
        self_type: TypeId,
        r#trait: Option<TraitImplementation>,
        members: Vec<AssociatedMember>,
    },
}

pub struct PendingScope { pub value: Scope, pub spans: Vec<Span> }

pub fn visibility(graph: &mut TypeGraph<'_, '_>, value: ty::Visibility<DefId>) -> Result<Visibility, String> {
    graph.reserve(0)?;
    Ok(match value {
        ty::Visibility::Public => Visibility::Public,
        ty::Visibility::Restricted(module) => Visibility::Restricted { module: graph.definition(module)? },
    })
}

pub fn collect_scope(graph: &mut TypeGraph<'_, '_>, owner: DefId) -> Result<Option<PendingScope>, String> {
    let Some(local) = owner.as_local() else { return Ok(None); };
    let context = graph.context;
    let mut spans = Vec::new();
    let value = match context.def_kind(owner) {
        DefKind::Mod | DefKind::Enum | DefKind::Trait => {
            graph.reserve(0)?;
            let bindings = context.module_children_local(local).iter()
                .map(|child| binding(graph, child, &mut spans)).collect::<Result<_, _>>()?;
            let mut ambiguities = Vec::new();
            if let Some(children) = context.resolutions(()).ambig_module_children.get(&local) {
                for child in children {
                    graph.reserve(0)?;
                    ambiguities.push(Ambiguity {
                        main: binding(graph, &child.main, &mut spans)?,
                        second: binding(graph, &child.second, &mut spans)?,
                    });
                }
            }
            Scope::Named { owner: definition_id(owner), bindings, ambiguities }
        }
        DefKind::Impl { of_trait } => {
            graph.reserve(0)?;
            let self_type = graph.ty(context.type_of(owner).instantiate_identity().skip_norm_wip())?;
            let r#trait = if of_trait {
                let header = context.impl_trait_header(owner);
                let reference = header.trait_ref.instantiate_identity().skip_norm_wip();
                Some(TraitImplementation {
                    definition: graph.definition(reference.def_id)?, arguments: graph.arguments(reference.args)?,
                    polarity: match header.polarity {
                        ty::ImplPolarity::Positive => "positive", ty::ImplPolarity::Negative => "negative", ty::ImplPolarity::Reservation => "reservation",
                    },
                    safety: match header.safety { rustc_hir::Safety::Safe => "safe", rustc_hir::Safety::Unsafe => "unsafe" },
                    constness: match header.constness {
                        rustc_hir::Constness::Const { always: true } => "comptime",
                        rustc_hir::Constness::Const { always: false } => "const",
                        rustc_hir::Constness::NotConst => "ordinary",
                    },
                })
            } else { None };
            let mut members = Vec::new();
            for member in context.associated_items(owner).in_definition_order() {
                graph.reserve(0)?;
                members.push(AssociatedMember {
                    definition: graph.definition(member.def_id)?,
                    trait_member: member.trait_item_def_id().map(|member| graph.definition(member)).transpose()?,
                });
            }
            Scope::Implementation { owner: definition_id(owner), self_type, r#trait, members }
        }
        _ => return Ok(None),
    };
    context.sess.dcx().abort_if_errors();
    Ok(Some(PendingScope { value, spans }))
}

fn binding(graph: &mut TypeGraph<'_, '_>, child: &ModChild, spans: &mut Vec<Span>) -> Result<Binding, String> {
    graph.reserve(0)?;
    spans.push(child.ident.span);
    let namespace = match child.res.ns() {
        Some(Namespace::TypeNS) => "type", Some(Namespace::ValueNS) => "value", Some(Namespace::MacroNS) => "macro",
        None => return Err("Native module binding has no namespace.".to_owned()),
    };
    let resolution = match child.res {
        Res::Def(_, definition) => BindingResolution::Declaration { definition: graph.definition(definition)? },
        Res::PrimTy(value) => BindingResolution::Primitive { name: value.name_str().to_owned() },
        Res::SelfTyParam { trait_ } => BindingResolution::SelfParameter { definition: graph.definition(trait_)? },
        Res::SelfTyAlias { alias_to, is_trait_impl } => BindingResolution::SelfAlias { definition: graph.definition(alias_to)?, trait_implementation: is_trait_impl },
        Res::SelfCtor(definition) => BindingResolution::SelfConstructor { definition: graph.definition(definition)? },
        Res::ToolMod => BindingResolution::ToolModule,
        Res::OpenMod(name) => BindingResolution::OpenModule { name: name.to_string() },
        Res::NonMacroAttr(kind) => match kind {
            NonMacroAttrKind::Builtin(name) => BindingResolution::BuiltinAttribute { name: name.to_string() },
            NonMacroAttrKind::Tool => BindingResolution::ToolAttribute,
            NonMacroAttrKind::DeriveHelper => BindingResolution::DeriveHelper,
            NonMacroAttrKind::DeriveHelperCompat => BindingResolution::ForwardDeriveHelper,
        },
        Res::Local(_) | Res::Err => return Err("Native module binding has an invalid resolution.".to_owned()),
    };
    let mut reexports = Vec::new();
    for step in &child.reexport_chain {
        graph.reserve(0)?;
        reexports.push(match *step {
            Reexport::Single(definition) => ReexportStep::Single { definition: graph.definition(definition)? },
            Reexport::Glob(definition) => ReexportStep::Glob { definition: graph.definition(definition)? },
            Reexport::ExternCrate(definition) => ReexportStep::ExternCrate { definition: graph.definition(definition)? },
            Reexport::MacroUse => ReexportStep::MacroUse,
            Reexport::MacroExport => ReexportStep::MacroExport,
        });
    }
    Ok(Binding { name: child.ident.name.to_string(), namespace, source: source_span(graph.context, child.ident.span),
        visibility: visibility(graph, child.vis)?, resolution, reexports })
}
