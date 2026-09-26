use std::collections::{HashMap, HashSet};

use rustc_middle::ty::{self, TyCtxt};
use rustc_span::def_id::DefId;

use crate::evidence::{DefinitionId, definition_id};
use crate::request::{Budget, Limits};
use crate::type_model::{self as model, Argument, ConstantId, ConstantRow, Type, TypeId, TypeRow};
use crate::type_regions::bound_index;

pub struct TypeGraph<'tcx, 'limits> {
    pub context: TyCtxt<'tcx>,
    budget: Budget<'limits>,
    type_ids: HashMap<ty::Ty<'tcx>, TypeId>,
    pending_types: Vec<ty::Ty<'tcx>>,
    types: Vec<TypeRow>,
    constant_ids: HashMap<ty::Const<'tcx>, ConstantId>,
    pending_constants: Vec<ty::Const<'tcx>>,
    constants: Vec<ConstantRow>,
    definition_ids: HashSet<DefId>,
    pending_definitions: Vec<DefId>,
}

impl<'tcx, 'limits> TypeGraph<'tcx, 'limits> {
    pub fn new(context: TyCtxt<'tcx>, limits: &'limits Limits) -> Self {
        Self {
            context, budget: Budget::new(limits), type_ids: HashMap::new(), pending_types: Vec::new(),
            types: Vec::new(), constant_ids: HashMap::new(), pending_constants: Vec::new(),
            constants: Vec::new(), definition_ids: HashSet::new(), pending_definitions: Vec::new(),
        }
    }

    pub fn reserve(&mut self, depth: usize) -> Result<(), String> {
        self.budget.reserve(depth)
    }

    pub fn definition(&mut self, definition: DefId) -> Result<DefinitionId, String> {
        if self.definition_ids.insert(definition) {
            self.reserve(0)?;
            self.pending_definitions.push(definition);
        }
        Ok(definition_id(definition))
    }

    pub fn take_definitions(&mut self) -> Vec<DefId> {
        std::mem::take(&mut self.pending_definitions)
    }

    pub fn ty(&mut self, value: ty::Ty<'tcx>) -> Result<TypeId, String> {
        if let Some(id) = self.type_ids.get(&value) { return Ok(*id); }
        self.reserve(0)?;
        let id = u32::try_from(self.pending_types.len()).map_err(|_| "Native type index exceeds its wire range.")?;
        self.type_ids.insert(value, id);
        self.pending_types.push(value);
        Ok(id)
    }

    pub fn constant(&mut self, value: ty::Const<'tcx>) -> Result<ConstantId, String> {
        if let Some(id) = self.constant_ids.get(&value) { return Ok(*id); }
        self.reserve(0)?;
        let id = u32::try_from(self.pending_constants.len()).map_err(|_| "Native constant index exceeds its wire range.")?;
        self.constant_ids.insert(value, id);
        self.pending_constants.push(value);
        Ok(id)
    }

    pub fn expand(&mut self) -> Result<(), String> {
        while self.types.len() < self.pending_types.len() || self.constants.len() < self.pending_constants.len() {
            while self.types.len() < self.pending_types.len() {
                let index = self.types.len();
                let value = self.type_value(self.pending_types[index])?;
                self.types.push(TypeRow { id: index as u32, value });
            }
            while self.constants.len() < self.pending_constants.len() {
                let index = self.constants.len();
                let value = self.constant_value(self.pending_constants[index])?;
                self.constants.push(ConstantRow { id: index as u32, value });
            }
        }
        Ok(())
    }

    pub fn finish(self) -> (Vec<TypeRow>, Vec<ConstantRow>) {
        (self.types, self.constants)
    }

    pub fn arguments(&mut self, arguments: ty::GenericArgsRef<'tcx>) -> Result<Vec<Argument>, String> {
        arguments.iter().map(|argument| self.argument(argument)).collect()
    }

    pub fn argument(&mut self, argument: ty::GenericArg<'tcx>) -> Result<Argument, String> {
        self.reserve(0)?;
        Ok(match argument.kind() {
            ty::GenericArgKind::Type(value) => Argument::Type { id: self.ty(value)? },
            ty::GenericArgKind::Const(value) => Argument::Constant { id: self.constant(value)? },
            ty::GenericArgKind::Lifetime(value) => Argument::Lifetime { region: self.region(value)? },
        })
    }

    pub fn term(&mut self, term: ty::Term<'tcx>) -> Result<Argument, String> {
        self.reserve(0)?;
        Ok(match term.kind() {
            ty::TermKind::Ty(value) => Argument::Type { id: self.ty(value)? },
            ty::TermKind::Const(value) => Argument::Constant { id: self.constant(value)? },
        })
    }

    pub fn type_alias(&mut self, alias: ty::AliasTy<'tcx>) -> Result<model::Alias, String> {
        let (category, definition) = match alias.kind {
            ty::AliasTyKind::Projection { def_id } => ("projection", def_id),
            ty::AliasTyKind::Inherent { def_id } => ("inherent", def_id),
            ty::AliasTyKind::Opaque { def_id } => ("opaque", def_id),
            ty::AliasTyKind::Free { def_id } => ("free", def_id),
        };
        Ok(model::Alias { sort: "type", category, definition: self.definition(definition)?, arguments: self.arguments(alias.args)? })
    }

    fn type_value(&mut self, value: ty::Ty<'tcx>) -> Result<Type, String> {
        Ok(match *value.kind() {
            ty::Bool => Type::Primitive { name: "bool" },
            ty::Char => Type::Primitive { name: "char" },
            ty::Int(value) => Type::Primitive { name: match value {
                ty::IntTy::Isize => "isize", ty::IntTy::I8 => "i8", ty::IntTy::I16 => "i16",
                ty::IntTy::I32 => "i32", ty::IntTy::I64 => "i64", ty::IntTy::I128 => "i128",
            } },
            ty::Uint(value) => Type::Primitive { name: match value {
                ty::UintTy::Usize => "usize", ty::UintTy::U8 => "u8", ty::UintTy::U16 => "u16",
                ty::UintTy::U32 => "u32", ty::UintTy::U64 => "u64", ty::UintTy::U128 => "u128",
            } },
            ty::Float(value) => Type::Primitive { name: match value {
                ty::FloatTy::F16 => "f16", ty::FloatTy::F32 => "f32", ty::FloatTy::F64 => "f64", ty::FloatTy::F128 => "f128",
            } },
            ty::Str => Type::Primitive { name: "str" },
            ty::Never => Type::Primitive { name: "never" },
            ty::Adt(definition, arguments) => Type::Adt {
                definition: self.definition(definition.did())?, arguments: self.arguments(arguments)?,
            },
            ty::Foreign(definition) => Type::Foreign { definition: self.definition(definition)? },
            ty::Array(element, length) => Type::Array { element: self.ty(element)?, length: self.constant(length)? },
            ty::Pat(base, pattern) => Type::Pattern { base: self.ty(base)?, pattern: self.pattern(pattern, 0)? },
            ty::Slice(element) => Type::Slice { element: self.ty(element)? },
            ty::RawPtr(pointee, mutability) => Type::RawPointer { pointee: self.ty(pointee)?, mutable: mutability.is_mut() },
            ty::Ref(region, pointee, mutability) => Type::Reference {
                region: self.region(region)?, pointee: self.ty(pointee)?, mutable: mutability.is_mut(),
            },
            ty::FnDef(definition, arguments) => {
                let signature = self.context.fn_sig(definition).instantiate(self.context, arguments).skip_norm_wip();
                self.context.sess.dcx().abort_if_errors();
                Type::Function {
                    definition: self.definition(definition)?, arguments: self.arguments(arguments)?,
                    signature: self.binder(signature, Self::signature)?,
                }
            },
            ty::FnPtr(signature, header) => Type::FunctionPointer {
                signature: self.binder(signature.with(header), Self::signature)?,
            },
            ty::UnsafeBinder(binder) => Type::UnsafeBinder { binder: self.binder(binder.into(), Self::ty)? },
            ty::Dynamic(predicates, region) => Type::Dynamic {
                predicates: predicates.iter().map(|predicate| self.binder(predicate, Self::existential)).collect::<Result<_, _>>()?,
                region: self.region(region)?,
            },
            ty::Closure(definition, arguments) => Type::Closure {
                definition: self.definition(definition)?, arguments: self.arguments(arguments)?,
            },
            ty::CoroutineClosure(definition, arguments) => Type::CoroutineClosure {
                definition: self.definition(definition)?, arguments: self.arguments(arguments)?,
            },
            ty::Coroutine(definition, arguments) => Type::Coroutine {
                definition: self.definition(definition)?, arguments: self.arguments(arguments)?,
            },
            ty::CoroutineWitness(definition, arguments) => Type::CoroutineWitness {
                definition: self.definition(definition)?, arguments: self.arguments(arguments)?,
            },
            ty::Tuple(elements) => Type::Tuple { elements: elements.iter().map(|element| self.ty(element)).collect::<Result<_, _>>()? },
            ty::Alias(rigid, alias) => Type::Alias { alias: self.type_alias(alias)?, rigid: rigid == ty::IsRigid::Yes },
            ty::Param(parameter) => Type::Parameter { index: parameter.index, name: parameter.name.to_string() },
            ty::Bound(binder, variable) => Type::Bound {
                binder: bound_index(binder), variable: variable.var.as_u32(), declaration: self.bound_type(variable.kind)?,
            },
            ty::Placeholder(placeholder) => Type::Placeholder {
                universe: placeholder.universe.as_u32(), variable: placeholder.bound.var.as_u32(),
                declaration: self.bound_type(placeholder.bound.kind)?,
            },
            ty::Infer(inference) => {
                let (category, index) = match inference {
                    ty::TyVar(value) => ("type", value.as_u32()),
                    ty::IntVar(value) => ("integer", value.as_u32()),
                    ty::FloatVar(value) => ("float", value.as_u32()),
                    ty::FreshTy(value) => ("fresh-type", value),
                    ty::FreshIntTy(value) => ("fresh-integer", value),
                    ty::FreshFloatTy(value) => ("fresh-float", value),
                };
                Type::Inference { category, index }
            },
            ty::Error(_) => return Err("Native semantic evidence contains an error type.".to_owned()),
        })
    }

    fn signature(&mut self, signature: ty::FnSig<'tcx>) -> Result<model::Signature, String> {
        Ok(model::Signature {
            inputs: signature.inputs().iter().map(|input| self.ty(*input)).collect::<Result<_, _>>()?,
            output: self.ty(signature.output())?, variadic: signature.c_variadic(),
            unsafe_call: signature.safety().is_unsafe(), abi: signature.abi().as_str(),
        })
    }

    fn existential(&mut self, predicate: ty::ExistentialPredicate<'tcx>) -> Result<model::Existential, String> {
        Ok(match predicate {
            ty::ExistentialPredicate::Trait(value) => model::Existential::Trait {
                definition: self.definition(value.def_id)?, arguments: self.arguments(value.args)?,
            },
            ty::ExistentialPredicate::Projection(value) => model::Existential::Projection {
                definition: self.definition(value.def_id)?, arguments: self.arguments(value.args)?, term: self.term(value.term)?,
            },
            ty::ExistentialPredicate::AutoTrait(definition) => model::Existential::AutoTrait { definition: self.definition(definition)? },
        })
    }

    fn pattern(&mut self, pattern: ty::Pattern<'tcx>, depth: usize) -> Result<model::Pattern, String> {
        self.reserve(depth)?;
        Ok(match *pattern {
            ty::PatternKind::Range { start, end } => model::Pattern::Range { start: self.constant(start)?, end: self.constant(end)? },
            ty::PatternKind::Or(patterns) => model::Pattern::Or {
                patterns: patterns.iter().map(|pattern| self.pattern(pattern, depth + 1)).collect::<Result<_, _>>()?,
            },
            ty::PatternKind::NotNull => model::Pattern::NotNull,
        })
    }
}
