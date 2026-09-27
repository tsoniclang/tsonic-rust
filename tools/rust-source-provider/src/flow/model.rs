use serde::Serialize;

use crate::evidence::{DefinitionId, NodeId, SourceSpan};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BodyFlow {
    pub owner: DefinitionId,
    pub argument_count: usize,
    pub locals: Vec<Local>,
    pub blocks: Vec<Block>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Local {
    pub origin: Origin,
    pub binding: Option<NodeId>,
    pub guard_target: Option<usize>,
}

#[derive(Serialize)]
pub struct Origin {
    pub node: NodeId,
    pub source: Option<SourceSpan>,
}

#[derive(Serialize)]
pub struct Block {
    pub cleanup: bool,
    pub statements: Vec<Step>,
    pub terminator: Terminal,
}

#[derive(Serialize)]
pub struct Step {
    pub origin: Origin,
    pub accesses: Vec<Access>,
}

#[derive(Serialize)]
pub struct Access {
    pub kind: &'static str,
    pub local: usize,
    pub projections: Vec<Projection>,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum Projection {
    Dereference,
    Field { field: usize },
    Index { local: usize },
    ConstantIndex { offset: String, minimum_length: String, from_end: bool },
    Subslice { from: String, to: String, from_end: bool },
    Downcast { variant: usize },
    OpaqueCast,
    UnwrapUnsafeBinder,
}

#[derive(Serialize)]
pub struct Terminal {
    #[serde(flatten)]
    pub step: Step,
    pub control: Control,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum Control {
    Goto { target: usize },
    Switch { branches: Vec<Branch>, otherwise: usize },
    Return,
    Unreachable,
    UnwindResume,
    UnwindTerminate { reason: &'static str },
    Drop { target: usize, unwind: Unwind, drop: Option<usize> },
    Call { target: Option<usize>, unwind: Unwind },
    TailCall,
    Assert { target: usize, unwind: Unwind },
    Yield { resume: usize, drop: Option<usize> },
    CoroutineDrop,
    FalseEdge { real: usize, imaginary: usize },
    FalseUnwind { real: usize, unwind: Unwind },
    InlineAssembly { targets: Vec<usize>, unwind: Unwind },
}

#[derive(Serialize)]
pub struct Branch {
    pub value: String,
    pub target: usize,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Unwind {
    Continue,
    Unreachable,
    Terminate { reason: &'static str },
    Cleanup { target: usize },
}
