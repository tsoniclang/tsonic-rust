use rustc_middle::ty;
use rustc_span::def_id::DefId;

use crate::type_graph::TypeGraph;
use crate::type_model::{Alias, Clause, Generics, Parameter, ParameterKind};

impl<'tcx> TypeGraph<'tcx, '_> {
    pub fn generics(&mut self, owner: DefId) -> Result<Generics, String> {
        self.reserve(0)?;
        let source = self.context.generics_of(owner);
        let predicates = self.context.predicates_of(owner);
        self.context.sess.dcx().abort_if_errors();
        let mut parameters = Vec::new();
        for parameter in &source.own_params {
            self.reserve(0)?;
            let value = match parameter.kind {
                ty::GenericParamDefKind::Lifetime => ParameterKind::Lifetime,
                ty::GenericParamDefKind::Type { synthetic, has_default } => ParameterKind::Type {
                    synthetic,
                    default: if has_default {
                        Some(self.ty(self.context.type_of(parameter.def_id).instantiate_identity().skip_norm_wip())?)
                    } else { None },
                },
                ty::GenericParamDefKind::Const { has_default } => ParameterKind::Constant {
                    r#type: self.ty(self.context.type_of(parameter.def_id).instantiate_identity().skip_norm_wip())?,
                    default: if has_default {
                        Some(self.constant(self.context.const_param_default(parameter.def_id).instantiate_identity().skip_norm_wip())?)
                    } else { None },
                },
            };
            parameters.push(Parameter {
                definition: self.definition(parameter.def_id)?, index: parameter.index, name: parameter.name.to_string(),
                pure_wrt_drop: parameter.pure_wrt_drop, value,
            });
        }
        Ok(Generics {
            parent: source.parent.map(|parent| self.definition(parent)).transpose()?,
            parent_count: source.parent_count, has_self: source.has_self, parameters,
            predicates_parent: predicates.parent.map(|parent| self.definition(parent)).transpose()?,
            predicates: predicates.predicates.iter().map(|(predicate, _)| self.binder(predicate.kind(), Self::clause)).collect::<Result<_, _>>()?,
        })
    }

    fn clause(&mut self, clause: ty::ClauseKind<'tcx>) -> Result<Clause, String> {
        self.reserve(0)?;
        Ok(match clause {
            ty::ClauseKind::Trait(predicate) => Clause::Trait {
                definition: self.definition(predicate.trait_ref.def_id)?, arguments: self.arguments(predicate.trait_ref.args)?,
                polarity: match predicate.polarity { ty::PredicatePolarity::Positive => "positive", ty::PredicatePolarity::Negative => "negative" },
            },
            ty::ClauseKind::RegionOutlives(predicate) => Clause::RegionOutlives {
                longer: self.region(predicate.0)?, shorter: self.region(predicate.1)?,
            },
            ty::ClauseKind::TypeOutlives(predicate) => Clause::TypeOutlives { r#type: self.ty(predicate.0)?, region: self.region(predicate.1)? },
            ty::ClauseKind::Projection(predicate) => Clause::Projection {
                alias: self.alias_term(predicate.projection_term)?, term: self.term(predicate.term)?,
            },
            ty::ClauseKind::ConstArgHasType(constant, value) => Clause::ConstantType { constant: self.constant(constant)?, r#type: self.ty(value)? },
            ty::ClauseKind::WellFormed(term) => Clause::WellFormed { term: self.term(term)? },
            ty::ClauseKind::ConstEvaluatable(constant) => Clause::ConstantEvaluatable { constant: self.constant(constant)? },
            ty::ClauseKind::HostEffect(predicate) => Clause::HostEffect {
                definition: self.definition(predicate.trait_ref.def_id)?, arguments: self.arguments(predicate.trait_ref.args)?,
                constness: match predicate.constness { ty::BoundConstness::Const => "const", ty::BoundConstness::Maybe => "maybe" },
            },
            ty::ClauseKind::UnstableFeature(name) => Clause::UnstableFeature { name: name.to_string() },
        })
    }

    fn alias_term(&mut self, term: ty::AliasTerm<'tcx>) -> Result<Alias, String> {
        let (sort, category, definition) = match term.kind {
            ty::AliasTermKind::ProjectionTy { def_id } => ("type", "projection", def_id),
            ty::AliasTermKind::InherentTy { def_id } => ("type", "inherent", def_id),
            ty::AliasTermKind::OpaqueTy { def_id } => ("type", "opaque", def_id),
            ty::AliasTermKind::FreeTy { def_id } => ("type", "free", def_id),
            ty::AliasTermKind::AnonConst { def_id } => ("constant", "anonymous", def_id),
            ty::AliasTermKind::ProjectionConst { def_id } => ("constant", "projection", def_id),
            ty::AliasTermKind::FreeConst { def_id } => ("constant", "free", def_id),
            ty::AliasTermKind::InherentConst { def_id } => ("constant", "inherent", def_id),
        };
        Ok(Alias { sort, category, definition: self.definition(definition)?, arguments: self.arguments(term.args)? })
    }
}
