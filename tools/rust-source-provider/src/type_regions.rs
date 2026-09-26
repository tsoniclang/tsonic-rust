use rustc_middle::ty;

use crate::type_graph::TypeGraph;
use crate::type_model::{self as model, BoundIndex, BoundRegion, BoundType, LateRegion, Region, Variable};

pub fn bound_index(index: ty::BoundVarIndexKind) -> BoundIndex {
    match index {
        ty::BoundVarIndexKind::Bound(depth) => BoundIndex::Bound { depth: depth.as_u32() },
        ty::BoundVarIndexKind::Canonical => BoundIndex::Canonical,
    }
}

impl<'tcx, 'limits> TypeGraph<'tcx, 'limits> {
    pub fn bound_type(&mut self, kind: ty::BoundTyKind<'tcx>) -> Result<BoundType, String> {
        self.reserve(0)?;
        Ok(match kind {
            ty::BoundTyKind::Anon => BoundType::Anonymous,
            ty::BoundTyKind::Param(id) => BoundType::Named { definition: self.definition(id)? },
        })
    }

    pub fn bound_region(&mut self, kind: ty::BoundRegionKind<'tcx>) -> Result<BoundRegion, String> {
        self.reserve(0)?;
        Ok(match kind {
            ty::BoundRegionKind::Anon => BoundRegion::Anonymous,
            ty::BoundRegionKind::NamedForPrinting(name) => BoundRegion::Printed { name: name.to_string() },
            ty::BoundRegionKind::Named(id) => BoundRegion::Named { definition: self.definition(id)? },
            ty::BoundRegionKind::ClosureEnv => BoundRegion::ClosureEnvironment,
        })
    }

    pub fn region(&mut self, region: ty::Region<'tcx>) -> Result<Region, String> {
        self.reserve(0)?;
        Ok(match region.kind() {
            ty::ReEarlyParam(parameter) => Region::Early { index: parameter.index, name: parameter.name.to_string() },
            ty::ReBound(index, variable) => Region::Bound {
                binder: bound_index(index), variable: variable.var.as_u32(),
                declaration: self.bound_region(variable.kind)?,
            },
            ty::ReLateParam(parameter) => Region::Late {
                scope: self.definition(parameter.scope)?,
                declaration: match parameter.kind {
                    ty::LateParamRegionKind::Anon(index) => LateRegion::Anonymous { index },
                    ty::LateParamRegionKind::NamedAnon(index, name) => LateRegion::Printed { index, name: name.to_string() },
                    ty::LateParamRegionKind::Named(id) => LateRegion::Named { definition: self.definition(id)? },
                    ty::LateParamRegionKind::ClosureEnv => LateRegion::ClosureEnvironment,
                },
            },
            ty::ReStatic => Region::Static,
            ty::ReVar(variable) => Region::Inference { index: variable.as_u32() },
            ty::RePlaceholder(placeholder) => Region::Placeholder {
                universe: placeholder.universe.as_u32(), variable: placeholder.bound.var.as_u32(),
                declaration: self.bound_region(placeholder.bound.kind)?,
            },
            ty::ReErased => Region::Erased,
            ty::ReError(_) => return Err("Native semantic evidence contains an error region.".to_owned()),
        })
    }

    pub fn binder<Value: Copy, Output>(
        &mut self,
        binder: ty::Binder<'tcx, Value>,
        encode: impl FnOnce(&mut Self, Value) -> Result<Output, String>,
    ) -> Result<model::Binder<Output>, String> {
        self.reserve(0)?;
        let mut variables = Vec::new();
        for variable in binder.bound_vars() {
            self.reserve(0)?;
            variables.push(match variable {
                ty::BoundVariableKind::Ty(kind) => Variable::Type { declaration: self.bound_type(kind)? },
                ty::BoundVariableKind::Region(kind) => Variable::Lifetime { declaration: self.bound_region(kind)? },
                ty::BoundVariableKind::Const => Variable::Constant,
            });
        }
        Ok(model::Binder { variables, value: encode(self, binder.skip_binder())? })
    }
}
