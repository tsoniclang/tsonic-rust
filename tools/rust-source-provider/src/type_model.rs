use serde::Serialize;

use crate::evidence::DefinitionId;

pub type TypeId = u32;
pub type ConstantId = u32;

#[derive(Serialize)]
pub struct TypeRow {
    pub id: TypeId,
    pub value: Type,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum Type {
    Primitive { name: &'static str },
    Adt { definition: DefinitionId, arguments: Vec<Argument> },
    Foreign { definition: DefinitionId },
    Array { element: TypeId, length: ConstantId },
    Pattern { base: TypeId, pattern: Pattern },
    Slice { element: TypeId },
    RawPointer { pointee: TypeId, mutable: bool },
    Reference { region: Region, pointee: TypeId, mutable: bool },
    Function { definition: DefinitionId, arguments: Vec<Argument>, signature: Binder<Signature> },
    FunctionPointer { signature: Binder<Signature> },
    UnsafeBinder { binder: Binder<TypeId> },
    Dynamic { predicates: Vec<Binder<Existential>>, region: Region },
    Closure { definition: DefinitionId, arguments: Vec<Argument> },
    CoroutineClosure { definition: DefinitionId, arguments: Vec<Argument> },
    Coroutine { definition: DefinitionId, arguments: Vec<Argument> },
    CoroutineWitness { definition: DefinitionId, arguments: Vec<Argument> },
    Tuple { elements: Vec<TypeId> },
    Alias { alias: Alias, rigid: bool },
    Parameter { index: u32, name: String },
    Bound { binder: BoundIndex, variable: u32, declaration: BoundType },
    Placeholder { universe: u32, variable: u32, declaration: BoundType },
    Inference { category: &'static str, index: u32 },
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Pattern {
    Range { start: ConstantId, end: ConstantId },
    Or { patterns: Vec<Pattern> },
    NotNull,
}

#[derive(Serialize)]
pub struct ConstantRow {
    pub id: ConstantId,
    pub value: Constant,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Constant {
    Parameter { index: u32, name: String },
    Bound { binder: BoundIndex, variable: u32 },
    Placeholder { universe: u32, variable: u32 },
    Inference { category: &'static str, index: u32 },
    Alias { alias: Alias, rigid: bool },
    Scalar { r#type: TypeId, bytes: u64, bits: String },
    Aggregate { r#type: TypeId, fields: Vec<ConstantId> },
    Expression { operation: &'static str, arguments: Vec<Argument> },
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Argument {
    Type { id: TypeId },
    Constant { id: ConstantId },
    Lifetime { region: Region },
}

#[derive(Serialize)]
pub struct Alias {
    pub sort: &'static str,
    pub category: &'static str,
    pub definition: DefinitionId,
    pub arguments: Vec<Argument>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Signature {
    pub inputs: Vec<TypeId>,
    pub output: TypeId,
    pub variadic: bool,
    pub unsafe_call: bool,
    pub abi: &'static str,
}

#[derive(Serialize)]
pub struct Binder<Value> {
    pub variables: Vec<Variable>,
    pub value: Value,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Variable {
    Type { declaration: BoundType },
    Lifetime { declaration: BoundRegion },
    Constant,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum BoundIndex {
    Bound { depth: u32 },
    Canonical,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum BoundType {
    Anonymous,
    Named { definition: DefinitionId },
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum BoundRegion {
    Anonymous,
    Printed { name: String },
    Named { definition: DefinitionId },
    ClosureEnvironment,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum LateRegion {
    Anonymous { index: u32 },
    Printed { index: u32, name: String },
    Named { definition: DefinitionId },
    ClosureEnvironment,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Region {
    Early { index: u32, name: String },
    Bound { binder: BoundIndex, variable: u32, declaration: BoundRegion },
    Late { scope: DefinitionId, declaration: LateRegion },
    Static,
    Inference { index: u32 },
    Placeholder { universe: u32, variable: u32, declaration: BoundRegion },
    Erased,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Existential {
    Trait { definition: DefinitionId, arguments: Vec<Argument> },
    Projection { definition: DefinitionId, arguments: Vec<Argument>, term: Argument },
    AutoTrait { definition: DefinitionId },
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Clause {
    Trait { definition: DefinitionId, arguments: Vec<Argument>, polarity: &'static str },
    RegionOutlives { longer: Region, shorter: Region },
    TypeOutlives { r#type: TypeId, region: Region },
    Projection { alias: Alias, term: Argument },
    ConstantType { constant: ConstantId, r#type: TypeId },
    WellFormed { term: Argument },
    ConstantEvaluatable { constant: ConstantId },
    HostEffect { definition: DefinitionId, arguments: Vec<Argument>, constness: &'static str },
    UnstableFeature { name: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Generics {
    pub parent: Option<DefinitionId>,
    pub parent_count: usize,
    pub has_self: bool,
    pub parameters: Vec<Parameter>,
    pub predicates_parent: Option<DefinitionId>,
    pub predicates: Vec<Binder<Clause>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Parameter {
    pub definition: DefinitionId,
    pub index: u32,
    pub name: String,
    pub pure_wrt_drop: bool,
    pub value: ParameterKind,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ParameterKind {
    Lifetime,
    Type { synthetic: bool, default: Option<TypeId> },
    Constant { r#type: TypeId, default: Option<ConstantId> },
}
