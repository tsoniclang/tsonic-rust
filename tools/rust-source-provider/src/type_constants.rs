use rustc_middle::{mir, ty};

use crate::type_graph::TypeGraph;
use crate::type_model::{Alias, Constant};
use crate::type_regions::bound_index;

impl<'tcx> TypeGraph<'tcx, '_> {
    pub fn constant_value(&mut self, constant: ty::Const<'tcx>) -> Result<Constant, String> {
        Ok(match constant.kind() {
            ty::ConstKind::Param(parameter) => Constant::Parameter { index: parameter.index, name: parameter.name.to_string() },
            ty::ConstKind::Bound(binder, variable) => Constant::Bound { binder: bound_index(binder), variable: variable.var.as_u32() },
            ty::ConstKind::Placeholder(placeholder) => Constant::Placeholder {
                universe: placeholder.universe.as_u32(), variable: placeholder.bound.var.as_u32(),
            },
            ty::ConstKind::Infer(inference) => {
                let (category, index) = match inference {
                    ty::InferConst::Var(value) => ("constant", value.as_u32()),
                    ty::InferConst::Fresh(value) => ("fresh-constant", value),
                };
                Constant::Inference { category, index }
            },
            ty::ConstKind::Alias(rigid, alias) => Constant::Alias {
                alias: self.constant_alias(alias)?, rigid: rigid == ty::IsRigid::Yes,
            },
            ty::ConstKind::Value(value) => match **value.valtree {
                ty::ValTreeKind::Leaf(scalar) => Constant::Scalar {
                    r#type: self.ty(value.ty)?, bytes: scalar.size().bytes(), bits: scalar.to_bits(scalar.size()).to_string(),
                },
                ty::ValTreeKind::Branch(fields) => Constant::Aggregate {
                    r#type: self.ty(value.ty)?, fields: fields.iter().map(|field| self.constant(field)).collect::<Result<_, _>>()?,
                },
            },
            ty::ConstKind::Expr(expression) => Constant::Expression {
                operation: match expression.kind {
                    ty::ExprKind::Binop(operation) => binary_operation(operation),
                    ty::ExprKind::UnOp(operation) => match operation { mir::UnOp::Not => "not", mir::UnOp::Neg => "neg", mir::UnOp::PtrMetadata => "pointer-metadata" },
                    ty::ExprKind::FunctionCall => "call",
                    ty::ExprKind::Cast(kind) => match kind {
                        ty::abstract_const::CastKind::As => "as", ty::abstract_const::CastKind::Use => "use",
                    },
                },
                arguments: self.arguments(expression.args())?,
            },
            ty::ConstKind::Error(_) => return Err("Native semantic evidence contains an error constant.".to_owned()),
        })
    }

    pub fn constant_alias(&mut self, alias: ty::AliasConst<'tcx>) -> Result<Alias, String> {
        let (category, definition) = match alias.kind {
            ty::AliasConstKind::Projection { def_id } => ("projection", def_id),
            ty::AliasConstKind::Inherent { def_id } => ("inherent", def_id),
            ty::AliasConstKind::Free { def_id } => ("free", def_id),
            ty::AliasConstKind::Anon { def_id } => ("anonymous", def_id),
        };
        Ok(Alias { sort: "constant", category, definition: self.definition(definition)?, arguments: self.arguments(alias.args)? })
    }
}

fn binary_operation(operation: mir::BinOp) -> &'static str {
    match operation {
        mir::BinOp::Add => "add", mir::BinOp::AddUnchecked => "add-unchecked", mir::BinOp::AddWithOverflow => "add-with-overflow",
        mir::BinOp::Sub => "sub", mir::BinOp::SubUnchecked => "sub-unchecked", mir::BinOp::SubWithOverflow => "sub-with-overflow",
        mir::BinOp::Mul => "mul", mir::BinOp::MulUnchecked => "mul-unchecked", mir::BinOp::MulWithOverflow => "mul-with-overflow",
        mir::BinOp::Div => "div", mir::BinOp::Rem => "rem", mir::BinOp::BitXor => "bit-xor", mir::BinOp::BitAnd => "bit-and",
        mir::BinOp::BitOr => "bit-or", mir::BinOp::Shl => "shl", mir::BinOp::ShlUnchecked => "shl-unchecked",
        mir::BinOp::Shr => "shr", mir::BinOp::ShrUnchecked => "shr-unchecked", mir::BinOp::Eq => "eq", mir::BinOp::Lt => "lt",
        mir::BinOp::Le => "le", mir::BinOp::Ne => "ne", mir::BinOp::Ge => "ge", mir::BinOp::Gt => "gt",
        mir::BinOp::Cmp => "cmp", mir::BinOp::Offset => "offset",
    }
}
