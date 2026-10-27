import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustProjectTypeDefinition } from "../../../../target-model/types/project-types.js";
import type { RustProjectFieldEmission, RustProjectMethodPropertyEmission } from "../../../../target-model/records/objects/project-classes.js";
import type { RustLifetimeRef } from "../../../../target-model/lifetimes/model.js";
import { cloneRustExpression } from "../../../target-ast/syntax/expressions.js";
import type { RustExpr, RustFunctionParam, RustType } from "../../../target-ast/syntax/nodes.js";
import { rustTypeEquals } from "../../../target-ast/syntax/type-equality.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustReturnTypeFromCarrierInContext, rustTypeFromCarrierInContext } from "../../types/render.js";
import { planRustCallableParameters } from "../../declarations/callables/parameters.js";
import { createRustSyntheticNameState } from "../../names/synthetic.js";
import { rustProjectStateType as rustProjectNamedStateType } from "./names.js";
import { rustCapturedFieldStorage, rustCapturedFieldType } from "../captured-fields.js";

export interface ProjectFieldPlan {
  readonly storage: "stored" | "receiver-alias";
  readonly declaration: Node;
  readonly sourceName: string;
  readonly targetName: string;
  readonly storageIndex: number;
  readonly carrier: TargetTypeRef;
  readonly type: RustType;
  readonly storageType: RustType;
  readonly origin: "project" | "external";
  readonly readonly: boolean;
  readonly initializer?: Node;
}

export interface ProjectCallableShape {
  readonly params: readonly RustFunctionParam[];
  readonly returnType?: RustType;
  readonly errorType?: RustType;
  readonly isUnsafe: boolean;
}

export interface ProjectMethodPropertyPlan {
  readonly declaration: Node;
  readonly targetName: string;
  readonly callableType: RustType;
  readonly params: readonly RustFunctionParam[];
  readonly returnType?: RustType;
}

export interface ProjectAccessorPlan {
  readonly declaration: Node;
  readonly role: "read" | "write";
}

export interface ProjectClassStateLayer {
  readonly definition: RustProjectTypeDefinition;
  readonly carrier: TargetTypeRef;
  readonly fields: readonly ProjectFieldPlan[];
  readonly methodProperties: readonly ProjectMethodPropertyPlan[];
}

export function projectClassStateLayers(
  definition: RustProjectTypeDefinition, concreteCarrier: TargetTypeRef, context: RustPlanContext,
): readonly ProjectClassStateLayer[] | undefined {
  const layers = context.input.program.records.projectClassState.get(definition, concreteCarrier);
  if (layers === undefined) failRustPlannerInvariant("An admitted native class requires its exact sealed state lineage.", definition.declaration);
  return layers.map(layer => ({ definition: layer.definition, carrier: layer.carrier,
    fields: layer.fields.map(field => renderProjectField(field, context)),
    methodProperties: layer.methodProperties.map(property => renderProjectMethodProperty(property, context)) }));
}

export function projectOwnFields(
  definition: RustProjectTypeDefinition, receiverCarrier: TargetTypeRef, context: RustPlanContext,
): readonly ProjectFieldPlan[] | undefined {
  const fields = context.input.program.records.projectClassFields.get(definition, receiverCarrier);
  if (fields === undefined) failRustPlannerInvariant("An admitted project instance requires its exact sealed fields.", definition.declaration);
  return fields.map(field => renderProjectField(field, context));
}

function renderProjectField(field: RustProjectFieldEmission, context: RustPlanContext): ProjectFieldPlan {
  const type = rustTypeFromCarrierInContext(field.carrier, context);
  if (type === undefined) failRustPlannerInvariant("An admitted project field requires its exact native storage type.", field.declaration);
  return { ...field, type, storageType: field.origin === "external" ? type
    : rustCapturedFieldType(rustCapturedFieldStorage(field.declaration, context), type) };
}

export function projectOwnMethods(definition: RustProjectTypeDefinition, context: RustPlanContext): readonly Node[] {
  const methods = context.input.program.records.classMethods.get(definition.declaration);
  if (methods === undefined) failRustPlannerInvariant("An admitted project type requires its sealed method inventory.", definition.declaration);
  return methods;
}

export function projectOwnAccessors(definition: RustProjectTypeDefinition, context: RustPlanContext): readonly ProjectAccessorPlan[] {
  const accessors = context.input.program.records.projectClassAccessors.get(definition);
  if (accessors === undefined) failRustPlannerInvariant("An admitted project type requires its sealed accessor inventory.", definition.declaration);
  return accessors;
}

export function projectOwnMethodProperties(
  definition: RustProjectTypeDefinition, receiverCarrier: TargetTypeRef, context: RustPlanContext,
): readonly ProjectMethodPropertyPlan[] | undefined {
  const properties = context.input.program.records.projectMethodProperties.get(definition, receiverCarrier);
  if (properties === undefined) failRustPlannerInvariant("An admitted project instance requires its sealed writable-method inventory.", definition.declaration);
  return properties.map(property => renderProjectMethodProperty(property, context));
}

export function renderProjectMethodProperty(property: RustProjectMethodPropertyEmission, context: RustPlanContext): ProjectMethodPropertyPlan {
  const bindings = context.input.program.records.classImplementationContext.get(property.owner.declaration, property.ownerCarrier);
  if (bindings === undefined) failRustPlannerInvariant("An admitted writable method requires its exact native generic correspondence.", property.declaration);
  const shape = projectCallableShape(property.declaration, { ...context,
    typeParameterSubstitutions: bindings.types, lifetimeSubstitutions: bindings.lifetimes }, { methodTypeArgumentSubstitutions: new Map() });
  if (shape === undefined) failRustPlannerInvariant("An admitted writable method requires its exact native signature.", property.declaration);
  return { declaration: property.declaration, targetName: property.targetName,
    callableType: rustProjectMethodPropertyCallableType(shape), params: shape.params,
    ...(shape.returnType === undefined ? {} : { returnType: shape.returnType }) };
}

export function rustProjectMethodPropertyCallableType(shape: Pick<ProjectCallableShape, "params" | "returnType" | "errorType">): RustType {
  return { kind: "named", path: "rt::Callable", genericArguments: [
    { kind: "lifetime", lifetime: { kind: "static" } },
    { kind: "type", type: { kind: "tuple", elements: shape.params.map(parameter => parameter.type) } },
    { kind: "type", type: { kind: "named", path: "Result", genericArguments: [
      { kind: "type", type: shape.returnType ?? { kind: "unit" } },
      { kind: "type", type: shape.errorType! },
    ] } },
  ] };
}

export function projectMembers(definition: RustProjectTypeDefinition, context: RustPlanContext): readonly Node[] | undefined {
  const members = context.input.program.records.projectClassMembers.get(definition);
  if (members === undefined) failRustPlannerInvariant("An admitted project type requires its dense sealed member inventory.", definition.declaration);
  return members;
}

export function projectCallableShape(
  member: Node, context: RustPlanContext,
  options?: { readonly methodTypeArgumentSubstitutions?: ReadonlyMap<string, TargetTypeRef>;
    readonly safetyPlacement?: "declaration" | "getter" | "setter" },
): ProjectCallableShape | undefined {
  const selected = context.input.program.records.projectCallableSignature.get(member);
  if (selected === undefined) failRustPlannerInvariant("An admitted native project callable requires its object-safe signature.", member);
  const arguments_ = options?.methodTypeArgumentSubstitutions;
  if (selected.typeParameters.length !== (arguments_?.size ?? 0) ||
    selected.typeParameters.some(identity => !arguments_?.has(identity)))
    failRustPlannerInvariant("An admitted native project callable requires its exact selected specialization.", member);
  const substitutions = new Map(context.typeParameterSubstitutions ?? []);
  for (const [identity, carrier] of arguments_ ?? []) substitutions.set(identity, carrier);
  const selectedContext = { ...context, typeParameterSubstitutions: substitutions };
  const syntheticNames = createRustSyntheticNameState(context.input.program.source.ast, member, []);
  const parameters = planRustCallableParameters(selected.contract, selectedContext, syntheticNames, "signature");
  const returnType = selected.omitReturn ? undefined : rustReturnTypeFromCarrierInContext(selected.returnCarrier, selectedContext);
  const errorType = selected.errorCarrier === undefined ? undefined : rustTypeFromCarrierInContext(selected.errorCarrier, selectedContext);
  if (parameters === undefined || !selected.omitReturn && returnType === undefined || selected.fallible && errorType === undefined)
    failRustPlannerInvariant("An admitted project callable requires its exact native parameter, result and error types.", member);
  return { params: parameters.params, ...(returnType === undefined ? {} : { returnType }),
    ...(errorType === undefined ? {} : { errorType }), isUnsafe: selected.safety[options?.safetyPlacement ?? "declaration"] };
}

export function projectMemberImplementation(concrete: RustProjectTypeDefinition, contractMember: Node, context: RustPlanContext): Node | undefined {
  const selected = context.input.program.records.projectMemberImplementation.get(concrete, contractMember);
  if (selected === undefined) failRustPlannerInvariant("An admitted concrete project member requires its exact source correspondence.", contractMember);
  return selected;
}

export function projectFieldStoragePath(implementation: Node, layers: readonly ProjectClassStateLayer[], context: RustPlanContext): readonly string[] | undefined {
  const owner = layers[layers.length - 1];
  const path = owner === undefined ? undefined : context.input.program.records.projectFieldStoragePath.get(owner.definition, implementation);
  if (path === undefined) failRustPlannerInvariant("An admitted native project field requires its unique physical state path.", implementation);
  return path;
}

export function projectMethodPropertyStoragePath(implementation: Node, layers: readonly ProjectClassStateLayer[], context: RustPlanContext): readonly string[] | undefined {
  const owner = layers[layers.length - 1];
  const path = owner === undefined ? undefined : context.input.program.records.projectMethodPropertyPath.get(owner.definition, implementation);
  if (path === undefined) failRustPlannerInvariant("An admitted writable method requires its unique physical state path.", implementation);
  return path;
}

export function projectStateType(layers: readonly ProjectClassStateLayer[], context: RustPlanContext): RustType | undefined {
  const state = layers[layers.length - 1];
  if (state === undefined) failRustPlannerInvariant("An admitted project class requires its finalized native state.", context.sourceFile);
  return rustProjectNamedStateType(state.carrier, context);
}

export function projectTypeSubstitutions(
  definition: RustProjectTypeDefinition, carrier: TargetTypeRef, context: RustPlanContext,
): ReadonlyMap<string, TargetTypeRef> {
  const selected = context.input.program.records.classImplementationContext.get(definition.declaration, carrier);
  if (selected === undefined) failRustPlannerInvariant("An admitted project type requires its exact native generic bindings.", definition.declaration);
  return selected.types;
}

export function projectLifetimeSubstitutions(
  definition: RustProjectTypeDefinition, carrier: TargetTypeRef, context: RustPlanContext,
): ReadonlyMap<string, RustLifetimeRef> {
  const selected = context.input.program.records.classImplementationContext.get(definition.declaration, carrier);
  if (selected === undefined) failRustPlannerInvariant("An admitted project type requires its exact native lifetime bindings.", definition.declaration);
  return selected.lifetimes;
}

export function rustFunctionTypesMatch(
  leftParams: readonly RustFunctionParam[], leftReturn: RustType | undefined,
  rightParams: readonly RustFunctionParam[], rightReturn: RustType | undefined,
): boolean {
  return leftParams.length === rightParams.length &&
    leftParams.every((parameter, index) => rustTypeEquals(parameter.type, rightParams[index]?.type)) && rustTypeEquals(leftReturn, rightReturn);
}

export function rustRcType(inner: RustType): RustType {
  return { kind: "named", path: "alloc::rc::Rc", genericArguments: [{ kind: "type", type: inner }] };
}

export function cloneField(receiver: RustExpr, name: string): RustExpr {
  return cloneRustExpression({ kind: "field", receiver, name });
}
