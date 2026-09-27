use rustc_hir::{self as hir, ExprKind, HirId, StmtKind};
use serde::Serialize;

use super::{Collector, DefinitionId, NodeId, SourceSpan, node_id, source_span};

#[derive(Serialize)]
pub(crate) struct BodyEvaluation {
    pub owner: DefinitionId,
    pub parameters: Vec<NodeId>,
    pub root: NodeId,
    pub nodes: Vec<EvaluationNode>,
}

#[derive(Serialize)]
pub(crate) struct EvaluationNode {
    pub id: NodeId,
    pub source: Option<SourceSpan>,
    #[serde(flatten)]
    pub value: Evaluation,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum Evaluation {
    Operation { operation: &'static str, inputs: Vec<NodeId> },
    ShortCircuit { operator: &'static str, left: NodeId, right: NodeId },
    If { condition: NodeId, consequent: NodeId, alternative: Option<NodeId> },
    Match { input: NodeId, arms: Vec<Arm> },
    Loop { block: NodeId },
    BlockExpression { block: NodeId },
    Block {
        statements: Vec<Statement>,
        tail: Option<NodeId>,
        #[serde(rename = "targetedByBreak")]
        targeted_by_break: bool,
    },
    Let { pattern: NodeId, initializer: NodeId },
    Break { target: NodeId, value: Option<NodeId> },
    Continue { target: NodeId },
    Return { value: Option<NodeId> },
    Become { value: NodeId },
    Yield { value: NodeId },
    Closure { definition: DefinitionId },
    Const { definition: DefinitionId },
    Struct { fields: Vec<NodeId>, tail: StructTail },
    Assembly { options: u32, operands: Vec<AssemblyOperand> },
}

#[derive(Serialize)]
pub(crate) struct Arm {
    id: NodeId,
    pattern: NodeId,
    guard: Option<NodeId>,
    body: NodeId,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum Statement {
    Let { id: NodeId, pattern: NodeId, initializer: Option<NodeId>, alternative: Option<NodeId> },
    Item { definition: DefinitionId },
    Expression { expression: NodeId, semicolon: bool },
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum StructTail {
    None,
    Defaults,
    Base { expression: NodeId },
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum AssemblyOperand {
    Input { expression: NodeId },
    Output { expression: Option<NodeId>, late: bool },
    InputOutput { expression: NodeId, late: bool },
    SplitInputOutput { input: NodeId, output: Option<NodeId>, late: bool },
    Const { definition: DefinitionId },
    Function { expression: NodeId },
    Static { definition: DefinitionId },
    Label { block: NodeId },
}

impl Collector<'_, '_> {
    pub(super) fn evaluation(&mut self, expression: &hir::Expr<'_>, depth: usize) -> Result<EvaluationNode, String> {
        self.graph.reserve(depth)?;
        let single = |operation, input: &hir::Expr<'_>| Evaluation::Operation {
            operation, inputs: vec![node_id(input.hir_id)],
        };
        let pair = |operation, left: &hir::Expr<'_>, right: &hir::Expr<'_>| Evaluation::Operation {
            operation, inputs: vec![node_id(left.hir_id), node_id(right.hir_id)],
        };
        let value = match expression.kind {
            ExprKind::ConstBlock(block) => Evaluation::Const { definition: self.graph.definition(block.def_id.to_def_id())? },
            ExprKind::Array(inputs) => Evaluation::Operation { operation: "array", inputs: ids(inputs) },
            ExprKind::Tup(inputs) => Evaluation::Operation { operation: "tuple", inputs: ids(inputs) },
            ExprKind::Call(callee, arguments) => Evaluation::Operation {
                operation: "call", inputs: std::iter::once(node_id(callee.hir_id)).chain(ids(arguments)).collect(),
            },
            ExprKind::MethodCall(_, receiver, arguments, _) => Evaluation::Operation {
                operation: "method-call", inputs: std::iter::once(node_id(receiver.hir_id)).chain(ids(arguments)).collect(),
            },
            ExprKind::Binary(operator, left, right) => match operator.node {
                hir::BinOpKind::And | hir::BinOpKind::Or => Evaluation::ShortCircuit {
                    operator: if operator.node == hir::BinOpKind::And { "and" } else { "or" },
                    left: node_id(left.hir_id), right: node_id(right.hir_id),
                },
                _ => pair("binary", left, right),
            },
            ExprKind::Use(input, _) => single("use", input),
            ExprKind::Unary(_, input) => single("unary", input),
            ExprKind::Cast(input, _) => single("cast", input),
            ExprKind::Type(input, _) => single("type-ascription", input),
            ExprKind::DropTemps(input) => single("drop-temporaries", input),
            ExprKind::Field(input, _) => single("field", input),
            ExprKind::Index(base, index, _) => pair("index", base, index),
            ExprKind::AddrOf(_, _, input) => single("borrow", input),
            ExprKind::Repeat(input, _) => single("repeat", input),
            ExprKind::UnsafeBinderCast(_, input, _) => single("unsafe-binder-cast", input),
            ExprKind::Assign(place, value, _) => pair("assign", place, value),
            ExprKind::AssignOp(_, place, value) => pair("compound-assign", place, value),
            ExprKind::Lit(_) => Evaluation::Operation { operation: "literal", inputs: Vec::new() },
            ExprKind::Path(_) => Evaluation::Operation { operation: "path", inputs: Vec::new() },
            ExprKind::OffsetOf(..) => Evaluation::Operation { operation: "offset-of", inputs: Vec::new() },
            ExprKind::If(condition, consequent, alternative) => Evaluation::If {
                condition: node_id(condition.hir_id), consequent: node_id(consequent.hir_id),
                alternative: optional_id(alternative),
            },
            ExprKind::Loop(block, ..) => Evaluation::Loop { block: node_id(block.hir_id) },
            ExprKind::Block(block, _) => Evaluation::BlockExpression { block: node_id(block.hir_id) },
            ExprKind::Let(binding) => Evaluation::Let {
                pattern: node_id(binding.pat.hir_id), initializer: node_id(binding.init.hir_id),
            },
            ExprKind::Match(input, arms, _) => Evaluation::Match {
                input: node_id(input.hir_id), arms: arms.iter().map(|arm| {
                    self.graph.reserve(depth + 1)?;
                    Ok(Arm { id: node_id(arm.hir_id), pattern: node_id(arm.pat.hir_id),
                        guard: optional_id(arm.guard), body: node_id(arm.body.hir_id) })
                }).collect::<Result<_, String>>()?,
            },
            ExprKind::Break(destination, value) => Evaluation::Break {
                target: destination_id(destination)?, value: optional_id(value),
            },
            ExprKind::Continue(destination) => Evaluation::Continue { target: destination_id(destination)? },
            ExprKind::Ret(value) => Evaluation::Return { value: optional_id(value) },
            ExprKind::Become(value) => Evaluation::Become { value: node_id(value.hir_id) },
            ExprKind::Yield(value, _) => Evaluation::Yield { value: node_id(value.hir_id) },
            ExprKind::Closure(closure) => Evaluation::Closure { definition: self.graph.definition(closure.def_id.to_def_id())? },
            ExprKind::Struct(_, fields, tail) => Evaluation::Struct {
                fields: fields.iter().map(|field| node_id(field.expr.hir_id)).collect(),
                tail: match tail {
                    hir::StructTailExpr::None => StructTail::None,
                    hir::StructTailExpr::DefaultFields(_) => StructTail::Defaults,
                    hir::StructTailExpr::Base(expression) => StructTail::Base { expression: node_id(expression.hir_id) },
                    hir::StructTailExpr::NoneWithError(_) => return Err("Native struct evaluation contains a recovered error.".to_owned()),
                },
            },
            ExprKind::InlineAsm(assembly) => Evaluation::Assembly {
                options: u32::from(assembly.options.bits()),
                operands: assembly.operands.iter().map(|(operand, _)| self.assembly_operand(operand, depth + 1)).collect::<Result<_, _>>()?,
            },
            ExprKind::Err(_) => return Err("Native evaluation contains a recovered expression error.".to_owned()),
        };
        Ok(EvaluationNode { id: node_id(expression.hir_id), source: source_span(self.context, expression.span), value })
    }

    pub(super) fn block_evaluation(&mut self, block: &hir::Block<'_>, depth: usize) -> Result<EvaluationNode, String> {
        self.graph.reserve(depth)?;
        self.span_expansions(block.span)?;
        let statements = block.stmts.iter().map(|statement| {
            self.graph.reserve(depth + 1)?;
            Ok(match statement.kind {
                StmtKind::Let(binding) => Statement::Let {
                    id: node_id(binding.hir_id), pattern: node_id(binding.pat.hir_id),
                    initializer: optional_id(binding.init), alternative: binding.els.map(|block| node_id(block.hir_id)),
                },
                StmtKind::Item(item) => Statement::Item { definition: self.graph.definition(item.owner_id.to_def_id())? },
                StmtKind::Expr(expression) => Statement::Expression { expression: node_id(expression.hir_id), semicolon: false },
                StmtKind::Semi(expression) => Statement::Expression { expression: node_id(expression.hir_id), semicolon: true },
            })
        }).collect::<Result<_, String>>()?;
        Ok(EvaluationNode { id: node_id(block.hir_id), source: source_span(self.context, block.span),
            value: Evaluation::Block { statements, tail: optional_id(block.expr), targeted_by_break: block.targeted_by_break } })
    }

    fn assembly_operand(&mut self, operand: &hir::InlineAsmOperand<'_>, depth: usize) -> Result<AssemblyOperand, String> {
        self.graph.reserve(depth)?;
        Ok(match *operand {
            hir::InlineAsmOperand::In { expr, .. } => AssemblyOperand::Input { expression: node_id(expr.hir_id) },
            hir::InlineAsmOperand::Out { expr, late, .. } => AssemblyOperand::Output { expression: optional_id(expr), late },
            hir::InlineAsmOperand::InOut { expr, late, .. } => AssemblyOperand::InputOutput { expression: node_id(expr.hir_id), late },
            hir::InlineAsmOperand::SplitInOut { in_expr, out_expr, late, .. } => AssemblyOperand::SplitInputOutput {
                input: node_id(in_expr.hir_id), output: optional_id(out_expr), late,
            },
            hir::InlineAsmOperand::Const { anon_const } => AssemblyOperand::Const { definition: self.graph.definition(anon_const.def_id.to_def_id())? },
            hir::InlineAsmOperand::SymFn { expr } => AssemblyOperand::Function { expression: node_id(expr.hir_id) },
            hir::InlineAsmOperand::SymStatic { def_id, .. } => AssemblyOperand::Static { definition: self.graph.definition(def_id)? },
            hir::InlineAsmOperand::Label { block } => AssemblyOperand::Label { block: node_id(block.hir_id) },
        })
    }
}

fn ids(expressions: &[hir::Expr<'_>]) -> Vec<NodeId> {
    expressions.iter().map(|expression| node_id(expression.hir_id)).collect()
}

fn optional_id(expression: Option<&hir::Expr<'_>>) -> Option<NodeId> {
    expression.map(|expression| node_id(expression.hir_id))
}

fn destination_id(destination: hir::Destination) -> Result<NodeId, String> {
    destination.target_id.map(|target: HirId| node_id(target))
        .map_err(|_| "Native evaluation has an unresolved control-flow destination.".to_owned())
}
