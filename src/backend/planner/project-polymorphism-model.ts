import type { Node } from "@tsonic/tsts";
import {
  Node_Initializer,
  Node_Type,
} from "../../common/source-ast.js";
import type { TargetTypeRef } from "../../policy/types.js";
import {
  rustAsyncFunctionFactKey,
  rustFallibleFactKey,
  rustGeneratorFactKey,
  rustSourceCallableReturnFactKey,
} from "../../source/rust-facts/keys.js";
import { rustProjectObjectLayout } from "../../source/rust-target-semantics/project-object-layout.js";
import type { RustProjectTypeDefinition } from "../../source/rust-target-semantics/project-type-policy.js";
import {
  isRustUnitCarrier,
  rustSourceTypeCarrierValue,
} from "../../source/rust-target-types.js";
import type {
  RustExpr,
  RustFunctionParam,
  RustImplFunction,
  RustType,
} from "../rust-ast/nodes.js";
import {
  missingFactDiagnostic,
  unsupportedConstructDiagnostic,
} from "./diagnostics.js";
import {
  diagnosticInput,
} from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";
import { planRustCallableParameters } from "./callable-parameters.js";
import { createRustSyntheticNameState } from "./synthetic-names.js";
import { planProjectMethod } from "./declarations-nominal.js";
import { rustDeclarationRequiresUnsafe } from "./explicit-safety.js";
import { rustProjectObjectLayerType } from "./project-objects.js";

export interface ProjectFieldPlan {
  readonly declaration: Node;
  readonly sourceName: string;
  readonly storageIndex: number;
  readonly carrier: TargetTypeRef;
  readonly type: RustType;
  readonly origin: "project" | "external";
  readonly initializer?: Node;
}

export interface ProjectCallableShape {
  readonly params: readonly RustFunctionParam[];
  readonly returnType?: RustType;
  readonly fallible: boolean;
  readonly isUnsafe: boolean;
}

export interface ProjectClassStateLayer {
  readonly definition: RustProjectTypeDefinition;
  readonly carrier: TargetTypeRef;
  readonly fields: readonly ProjectFieldPlan[];
}

export function projectClassStateLayers(
  definition: RustProjectTypeDefinition,
  concreteCarrier: TargetTypeRef,
  context: RustPlanContext,
): readonly ProjectClassStateLayer[] | undefined {
  const lineage = context.input.projectTypes.classLineage(definition);
  if (lineage === undefined) {
    return undefined;
  }
  const layers: ProjectClassStateLayer[] = [];
  for (const owner of lineage) {
    const relation = context.input.projectTypes.relationship(concreteCarrier, owner);
    if (relation.kind !== "related") {
      return undefined;
    }
    const fields = projectOwnFields(owner, relation.targetType, context);
    if (fields === undefined) {
      return undefined;
    }
    layers.push({ definition: owner, carrier: relation.targetType, fields });
  }
  return layers;
}

export function projectOwnFields(
  definition: RustProjectTypeDefinition,
  receiverCarrier: TargetTypeRef,
  context: RustPlanContext,
): readonly ProjectFieldPlan[] | undefined {
  const layout = rustProjectObjectLayout(definition.declaration, context.input.ast);
  if (layout === undefined || layout.kind !== definition.kind) {
    return undefined;
  }
  const fields: ProjectFieldPlan[] = [];
  const externalBase = context.input.projectTypes.externalBaseForDefinition(definition);
  for (const field of externalBase?.fields ?? []) {
    const type = rustTypeFromCarrierInContext(field.carrier, context);
    if (type === undefined) {
      return undefined;
    }
    fields.push({
      declaration: field.declaration,
      sourceName: field.sourceName,
      storageIndex: field.storageIndex,
      carrier: field.carrier,
      type,
      origin: "external",
    });
  }
  const externalFieldCount = fields.length;
  for (const layoutField of layout.fields) {
    const declared = context.input.facts.getRuntimeCarrierFact(layoutField.declaration)?.carrier ??
      context.input.facts.getRuntimeCarrierFact(Node_Type(context.input.ast, layoutField.declaration))?.carrier;
    const carrier = declared === undefined
      ? undefined
      : context.input.projectTypes.instantiateMemberCarrier(
          layoutField.declaration,
          receiverCarrier,
          declared,
        );
    const type = rustTypeFromCarrierInContext(carrier, context);
    if (carrier === undefined || type === undefined) {
      return undefined;
    }
    const initializer = Node_Initializer(context.input.ast, layoutField.declaration);
    fields.push({
      declaration: layoutField.declaration,
      sourceName: layoutField.sourceName,
      storageIndex: externalFieldCount + layoutField.storageIndex,
      carrier,
      type,
      origin: "project",
      ...(initializer === undefined ? {} : { initializer }),
    });
  }
  return fields;
}

export function projectOwnMethods(
  definition: RustProjectTypeDefinition,
  context: RustPlanContext,
): readonly Node[] {
  return (projectMembers(definition, context) ?? []).filter((member) => {
    const kind = context.input.ast.kindName(member);
    return kind === "KindMethodDeclaration" || kind === "KindMethodSignature";
  });
}

export function projectMembers(
  definition: RustProjectTypeDefinition,
  context: RustPlanContext,
): readonly Node[] | undefined {
  const members = context.input.ast.members(definition.declaration);
  return members.every((member) => member !== undefined)
    ? members as readonly Node[]
    : undefined;
}

export function projectCallableShape(
  member: Node,
  context: RustPlanContext,
): ProjectCallableShape | undefined {
  if ((context.input.ast.typeParameters(member) as readonly (Node | undefined)[]).some((parameter) => parameter !== undefined) ||
    context.input.facts.getFact(member, rustGeneratorFactKey) !== undefined ||
    context.input.facts.getFact(member, rustAsyncFunctionFactKey) !== undefined ||
    context.input.ast.hasModifierKind(member, "async")) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, member),
      "rust.backend.project-dispatch-object-safety",
      "Polymorphic project methods must have an object-safe non-generic synchronous Rust ABI.",
    ));
    return undefined;
  }
  const syntheticNames = createRustSyntheticNameState(context.input.ast, member, []);
  const parameterPlan = planRustCallableParameters(member, context, syntheticNames, { requireStatic: false });
  const returnCarrier = context.input.facts.getFact(member, rustSourceCallableReturnFactKey)?.returnCarrier;
  if (parameterPlan === undefined || returnCarrier === undefined) {
    return undefined;
  }
  const returnType = isRustUnitCarrier(returnCarrier)
    ? undefined
    : rustTypeFromCarrierInContext(returnCarrier, context);
  if (!isRustUnitCarrier(returnCarrier) && returnType === undefined) {
    return undefined;
  }
  return {
    params: parameterPlan.params,
    ...(returnType === undefined ? {} : { returnType }),
    fallible: context.input.facts.getFact(member, rustFallibleFactKey) !== undefined,
    isUnsafe: rustDeclarationRequiresUnsafe(
      member,
      "declaration",
      context.input,
    ),
  };
}

export function projectMemberImplementation(
  concrete: RustProjectTypeDefinition,
  contractMember: Node,
  context: RustPlanContext,
): Node | undefined {
  const selected = context.input.projectTypes.memberImplementation(concrete, contractMember);
  if (selected.kind !== "resolved") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, contractMember),
      "rust.backend.project-member-implementation",
      selected.kind === "unresolved"
        ? selected.reason
        : "Concrete project class is unrelated to the selected member contract.",
    ));
    return undefined;
  }
  return selected.implementation.declaration;
}

export function projectFieldStoragePath(
  implementation: Node,
  layers: readonly ProjectClassStateLayer[],
  _context: RustPlanContext,
): readonly number[] | undefined {
  const matches = layers.flatMap((layer, ownerIndex) =>
    layer.fields
      .filter((candidate) => candidate.declaration === implementation)
      .map((field) => ({ ownerIndex, field })));
  if (matches.length !== 1) {
    return undefined;
  }
  const { ownerIndex, field } = matches[0]!;
  const path: number[] = [];
  for (let depth = layers.length - 1; depth > ownerIndex; depth -= 1) {
    path.push(0);
  }
  if (layers.length > 1 && ownerIndex > 0) {
    path.push(1);
  }
  path.push(field.storageIndex);
  return path;
}

export function projectStateType(layers: readonly ProjectClassStateLayer[]): RustType {
  const types = layers.map((layer) =>
    rustProjectObjectLayerType(layer.fields.map((field) => field.type)));
  let state = types[0]!;
  for (const own of types.slice(1)) {
    state = { kind: "tuple", elements: [state, own] };
  }
  return state;
}

export function projectTypeSubstitutions(
  definition: RustProjectTypeDefinition,
  carrier: TargetTypeRef,
): ReadonlyMap<string, TargetTypeRef> {
  const value = rustSourceTypeCarrierValue(carrier);
  return new Map(definition.typeParameterNames.map((name, index) =>
    [name, value?.typeArguments[index] ?? { kind: "type-parameter", name }] as const));
}

export function planProjectStaticMethods(
  definition: RustProjectTypeDefinition,
  context: RustPlanContext,
): readonly RustImplFunction[] | undefined {
  const methods: RustImplFunction[] = [];
  for (const member of projectOwnMethods(definition, context)) {
    if (!context.input.ast.hasModifierKind(member, "static")) {
      continue;
    }
    const planned = planProjectMethod(member, context);
    if (planned === undefined) {
      return undefined;
    }
    methods.push(planned);
  }
  return methods;
}

export function rustFunctionTypesMatch(
  leftParams: readonly RustFunctionParam[],
  leftReturn: RustType | undefined,
  rightParams: readonly RustFunctionParam[],
  rightReturn: RustType | undefined,
): boolean {
  return leftParams.length === rightParams.length &&
    leftParams.every((parameter, index) =>
      rustTypeEquals(parameter.type, rightParams[index]?.type)) &&
    rustTypeEquals(leftReturn, rightReturn);
}

function rustTypeEquals(left: RustType | undefined, right: RustType | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  if (left.kind !== right.kind) {
    return false;
  }
  switch (left.kind) {
    case "primitive":
      return right.kind === "primitive" && left.name === right.name;
    case "string":
    case "str-ref":
    case "unit":
      return true;
    case "named":
      return right.kind === "named" && left.path === right.path &&
        sameStrings(left.lifetimeArguments, right.lifetimeArguments) &&
        sameTypes(left.typeArguments, right.typeArguments);
    case "trait-object":
      return right.kind === "trait-object" && rustTypeEquals(left.trait, right.trait);
    case "reference":
      return right.kind === "reference" && left.mutable === right.mutable &&
        rustTypeEquals(left.referent, right.referent);
    case "raw-pointer":
      return right.kind === "raw-pointer" && left.mutable === right.mutable &&
        rustTypeEquals(left.pointee, right.pointee);
    case "fixed-array":
      return right.kind === "fixed-array" && left.length === right.length &&
        rustTypeEquals(left.element, right.element);
    case "slice-ref":
      return right.kind === "slice-ref" && left.mutable === right.mutable &&
        rustTypeEquals(left.element, right.element);
    case "function-pointer":
      return right.kind === "function-pointer" && left.isUnsafe === right.isUnsafe &&
        sameStrings(left.abi, right.abi) &&
        sameTypes(left.parameters, right.parameters) && rustTypeEquals(left.result, right.result);
    case "tuple":
      return right.kind === "tuple" && sameTypes(left.elements, right.elements);
  }
}

function sameStrings(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  return (left ?? []).length === (right ?? []).length &&
    (left ?? []).every((value, index) => value === (right ?? [])[index]);
}

function sameTypes(left: readonly RustType[] | undefined, right: readonly RustType[] | undefined): boolean {
  return (left ?? []).length === (right ?? []).length &&
    (left ?? []).every((value, index) => rustTypeEquals(value, (right ?? [])[index]));
}

export function rustRcType(inner: RustType): RustType {
  return { kind: "named", path: "std::rc::Rc", typeArguments: [inner] };
}

export function cloneExpression(expression: RustExpr): RustExpr {
  return { kind: "method-call", receiver: expression, method: "clone", args: [] };
}

export function cloneField(receiver: RustExpr, name: string): RustExpr {
  return cloneExpression({ kind: "field", receiver, name });
}
