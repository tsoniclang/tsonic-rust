import type { Node } from "@tsonic/tsts";
import {
  Node_Initializer,
  Node_Type,
} from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import {
  rustAsyncFunctionFactKey,
  rustFallibleFactKey,
  rustGeneratorFactKey,
  rustSourceCallableReturnFactKey,
} from "../../../../analysis/facts/keys.js";
import { rustProjectObjectLayout } from "../../../../analysis/project-types/object-layout.js";
import type { RustProjectTypeDefinition } from "../../../../analysis/project-types/type-policy.js";
import {
  isRustUnitCarrier,
  isRustNeverCarrier,
  rustSourceTypeCarrierValue,
} from "../../../../policy/types/target-types.js";
import type {
  RustExpr,
  RustFunctionParam,
  RustType,
} from "../../../target-ast/nodes.js";
import { rustTypeEquals } from "../../../target-ast/inspection/type-equality.js";
import {
  missingFactDiagnostic,
  unsupportedConstructDiagnostic,
} from "../../diagnostics.js";
import {
  diagnosticInput,
  rustErrorBoundaryForProjectMember,
  rustErrorType,
} from "../../program/plan-context.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustReturnTypeFromCarrierInContext, rustTypeFromCarrierInContext } from "../../types/render.js";
import { planRustCallableParameters } from "../../declarations/callable-parameters.js";
import { createRustSyntheticNameState } from "../../names/synthetic.js";
import { rustDeclarationRequiresUnsafe } from "../../safety/explicit-safety.js";
import { rustProjectStateType as rustProjectNamedStateType } from "./names.js";

export interface ProjectFieldPlan {
  readonly declaration: Node;
  readonly sourceName: string;
  readonly targetName: string;
  readonly storageIndex: number;
  readonly carrier: TargetTypeRef;
  readonly type: RustType;
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
  definition: RustProjectTypeDefinition,
  concreteCarrier: TargetTypeRef,
  context: RustPlanContext,
): readonly ProjectClassStateLayer[] | undefined {
  const lineage = context.input.program.projectTypes.classLineage(definition);
  if (lineage === undefined) {
    return undefined;
  }
  const layers: ProjectClassStateLayer[] = [];
  for (const owner of lineage) {
    const relation = context.input.program.projectTypes.relationship(concreteCarrier, owner);
    if (relation.kind !== "related") {
      return undefined;
    }
    const fields = projectOwnFields(owner, relation.targetType, context);
    const methodProperties = projectOwnMethodProperties(
      owner,
      relation.targetType,
      context,
    );
    if (fields === undefined || methodProperties === undefined) {
      return undefined;
    }
    layers.push({
      definition: owner,
      carrier: relation.targetType,
      fields,
      methodProperties,
    });
  }
  return layers;
}

export function projectOwnFields(
  definition: RustProjectTypeDefinition,
  receiverCarrier: TargetTypeRef,
  context: RustPlanContext,
): readonly ProjectFieldPlan[] | undefined {
  const layout = rustProjectObjectLayout(definition.declaration, context.input.program.source.ast);
  if (layout === undefined || layout.kind !== definition.kind) {
    return undefined;
  }
  const fields: ProjectFieldPlan[] = [];
  const externalBase = context.input.program.projectTypes.externalBaseForDefinition(definition);
  for (const field of externalBase?.fields ?? []) {
    const type = rustTypeFromCarrierInContext(field.carrier, context);
    const targetName = context.input.program.projectTypes.fieldStorageName(definition, field.declaration);
    if (type === undefined || targetName === undefined) {
      return undefined;
    }
    fields.push({
      declaration: field.declaration,
      sourceName: field.sourceName,
      targetName,
      storageIndex: field.storageIndex,
      carrier: field.carrier,
      type,
      origin: "external",
      readonly: false,
    });
  }
  const externalFieldCount = fields.length;
  for (const layoutField of layout.fields) {
    const declared = context.input.program.facts.getRuntimeCarrierFact(layoutField.declaration)?.carrier ??
      context.input.program.facts.getRuntimeCarrierFact(Node_Type(context.input.program.source.ast, layoutField.declaration))?.carrier;
    const carrier = declared === undefined
      ? undefined
      : context.input.program.projectTypes.instantiateMemberCarrier(
          layoutField.declaration,
          receiverCarrier,
          declared,
        );
    const type = rustTypeFromCarrierInContext(carrier, context);
    const targetName = context.input.program.projectTypes.fieldStorageName(
      definition,
      layoutField.declaration,
    );
    if (carrier === undefined || isRustNeverCarrier(carrier) ||
      type === undefined || targetName === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, layoutField.declaration),
        "rust.backend.class",
        `Class field '${layoutField.sourceName}' has no supported Rust storage identity or carrier fact.`,
      ));
      return undefined;
    }
    const initializer = Node_Initializer(context.input.program.source.ast, layoutField.declaration);
    fields.push({
      declaration: layoutField.declaration,
      sourceName: layoutField.sourceName,
      targetName,
      storageIndex: externalFieldCount + layoutField.storageIndex,
      carrier,
      type,
      origin: "project",
      readonly: context.input.program.source.ast.hasModifierKind(layoutField.declaration, "readonly"),
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
    const kind = context.input.program.source.ast.kindName(member);
    return kind === "KindMethodDeclaration" || kind === "KindMethodSignature";
  });
}

export function projectOwnAccessors(
  definition: RustProjectTypeDefinition,
  context: RustPlanContext,
): readonly ProjectAccessorPlan[] {
  return (projectMembers(definition, context) ?? []).flatMap<ProjectAccessorPlan>((member) => {
    if (context.input.program.source.ast.hasModifierKind(member, "static")) {
      return [];
    }
    const kind = context.input.program.source.ast.kindName(member);
    return kind === "KindGetAccessor"
      ? [{ declaration: member, role: "read" }]
      : kind === "KindSetAccessor"
        ? [{ declaration: member, role: "write" }]
        : [];
  });
}

export function projectOwnMethodProperties(
  definition: RustProjectTypeDefinition,
  receiverCarrier: TargetTypeRef,
  context: RustPlanContext,
): readonly ProjectMethodPropertyPlan[] | undefined {
  const properties: ProjectMethodPropertyPlan[] = [];
  const seen = new Set<Node>();
  for (const member of projectOwnMethods(definition, context)) {
    if (context.input.program.source.ast.hasModifierKind(member, "static")) {
      continue;
    }
    const implementation = context.input.program.source.navigation.callableImplementation(member);
    const declaration = implementation.kind === "resolved"
      ? implementation.implementation.declaration
      : member;
    if (seen.has(declaration)) {
      continue;
    }
    const usage = context.input.program.projectMethodProperties.usageFor(member) ??
      context.input.program.projectMethodProperties.usageFor(declaration);
    if (usage?.writable !== true) {
      continue;
    }
    if (context.input.program.source.ast.typeParameters(declaration).length !== 0) {
      return undefined;
    }
    const owner = context.input.program.projectTypes.definitionContainingDeclaration(declaration);
    const relation = owner === undefined
      ? undefined
      : context.input.program.projectTypes.relationship(receiverCarrier, owner);
    const shape = owner === undefined || relation?.kind !== "related"
      ? undefined
      : projectCallableShape(declaration, {
          ...context,
          typeParameterSubstitutions: projectTypeSubstitutions(owner, relation.targetType),
        }, { methodTypeArgumentSubstitutions: new Map() });
    const targetName = owner === undefined
      ? undefined
      : context.input.program.projectTypes.fieldStorageName(owner, declaration);
    if (shape === undefined || targetName === undefined || shape.isUnsafe ||
      shape.errorType === undefined) {
      return undefined;
    }
    seen.add(declaration);
    properties.push({
      declaration,
      targetName,
      callableType: rustProjectMethodPropertyCallableType(shape),
      params: shape.params,
      ...(shape.returnType === undefined ? {} : { returnType: shape.returnType }),
    });
  }
  return Object.freeze(properties);
}

export function rustProjectMethodPropertyCallableType(
  shape: Pick<ProjectCallableShape, "params" | "returnType" | "errorType">,
): RustType {
  const resultType = shape.returnType ?? { kind: "unit" as const };
  return {
    kind: "named",
    path: "rt::Callable",
    typeArguments: [{
      kind: "tuple",
      elements: shape.params.map((parameter) => parameter.type),
    }, {
      kind: "named",
      path: "Result",
      typeArguments: [resultType, shape.errorType!],
    }],
  };
}

export function projectMembers(
  definition: RustProjectTypeDefinition,
  context: RustPlanContext,
): readonly Node[] | undefined {
  const members = context.input.program.source.ast.members(definition.declaration);
  return members.every((member) => member !== undefined)
    ? members as readonly Node[]
    : undefined;
}

export function projectCallableShape(
  member: Node,
  context: RustPlanContext,
  options?: {
    readonly methodTypeArgumentSubstitutions?: ReadonlyMap<string, TargetTypeRef>;
    readonly safetyPlacement?: "declaration" | "getter" | "setter";
  },
): ProjectCallableShape | undefined {
  const methodTypeArgumentSubstitutions = options?.methodTypeArgumentSubstitutions;
  const methodTypeParameters = context.input.program.source.ast.typeParameters(member);
  const methodTypeParameterNames = methodTypeParameters.map((parameter) => {
    const name = parameter === undefined ? undefined : context.input.program.source.ast.name(parameter);
    return name === undefined ? undefined : context.input.program.source.ast.text(name);
  });
  const methodSpecializationValid = methodTypeParameters.length === 0
    ? methodTypeArgumentSubstitutions === undefined || methodTypeArgumentSubstitutions.size === 0
    : methodTypeArgumentSubstitutions !== undefined &&
      methodTypeArgumentSubstitutions.size === methodTypeParameters.length &&
      methodTypeParameterNames.every((name) =>
        name !== undefined && name.length > 0 && methodTypeArgumentSubstitutions.has(name));
  if (!methodSpecializationValid ||
    context.input.program.facts.getFact(member, rustGeneratorFactKey) !== undefined ||
    context.input.program.facts.getFact(member, rustAsyncFunctionFactKey) !== undefined ||
    context.input.program.source.ast.hasModifierKind(member, "async")) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, member),
      "rust.backend.project-dispatch-object-safety",
      "Polymorphic project methods must have an object-safe non-generic synchronous Rust ABI.",
    ));
    return undefined;
  }
  const substitutions = new Map(context.typeParameterSubstitutions ?? []);
  for (const [name, carrier] of methodTypeArgumentSubstitutions ?? []) {
    substitutions.set(name, carrier);
  }
  const selectedContext = substitutions.size === 0
    ? context
    : { ...context, typeParameterSubstitutions: substitutions };
  const syntheticNames = createRustSyntheticNameState(selectedContext.input.program.source.ast, member, []);
  const parameterPlan = planRustCallableParameters(member, selectedContext, syntheticNames, { requireStatic: false });
  const returnCarrier = selectedContext.input.program.facts.getFact(member, rustSourceCallableReturnFactKey)?.returnCarrier;
  if (parameterPlan === undefined || returnCarrier === undefined) {
    return undefined;
  }
  const fallible = context.input.program.facts.getFact(member, rustFallibleFactKey) !== undefined;
  const errorBoundary = fallible
    ? rustErrorBoundaryForProjectMember(member, selectedContext)
    : undefined;
  if (fallible && errorBoundary === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, member),
      "rust.backend.project-dispatch-error-boundary",
      "Polymorphic project method has no exact source-package error boundary.",
    ));
    return undefined;
  }
  const returnType = isRustUnitCarrier(returnCarrier) || fallible && isRustNeverCarrier(returnCarrier)
    ? undefined
    : rustReturnTypeFromCarrierInContext(returnCarrier, selectedContext);
  if (!isRustUnitCarrier(returnCarrier) && !(fallible && isRustNeverCarrier(returnCarrier)) && returnType === undefined) {
    return undefined;
  }
  return {
    params: parameterPlan.params,
    ...(returnType === undefined ? {} : { returnType }),
    ...(errorBoundary === undefined ? {} : { errorType: rustErrorType(errorBoundary) }),
    isUnsafe: rustDeclarationRequiresUnsafe(
      member,
      options?.safetyPlacement ?? "declaration",
      selectedContext.input,
    ),
  };
}

export function projectMemberImplementation(
  concrete: RustProjectTypeDefinition,
  contractMember: Node,
  context: RustPlanContext,
): Node | undefined {
  const selected = context.input.program.projectTypes.memberImplementation(concrete, contractMember);
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
  context: RustPlanContext,
): readonly string[] | undefined {
  const matches = layers.flatMap((layer, ownerIndex) =>
    layer.fields
      .filter((candidate) => candidate.declaration === implementation)
      .map((field) => ({ ownerIndex, field })));
  if (matches.length !== 1) {
    return undefined;
  }
  const { ownerIndex, field } = matches[0]!;
  const path: string[] = [];
  for (let depth = layers.length - 1; depth > ownerIndex; depth -= 1) {
    path.push(context.input.program.projectTypes.baseStateFieldName(layers[depth]!.definition));
  }
  path.push(field.targetName);
  return path;
}

export function projectMethodPropertyStoragePath(
  implementation: Node,
  layers: readonly ProjectClassStateLayer[],
  context: RustPlanContext,
): readonly string[] | undefined {
  const owner = context.input.program.projectTypes.definitionContainingDeclaration(implementation);
  const ownerIndex = owner === undefined
    ? -1
    : layers.findIndex((layer) => layer.definition === owner);
  const targetName = owner === undefined
    ? undefined
    : context.input.program.projectTypes.fieldStorageName(owner, implementation);
  if (ownerIndex < 0 || targetName === undefined) {
    return undefined;
  }
  const path: string[] = [];
  for (let depth = layers.length - 1; depth > ownerIndex; depth -= 1) {
    path.push(context.input.program.projectTypes.baseStateFieldName(layers[depth]!.definition));
  }
  path.push(targetName);
  return path;
}

export function projectStateType(
  layers: readonly ProjectClassStateLayer[],
  context: RustPlanContext,
): RustType | undefined {
  const state = layers[layers.length - 1];
  return state === undefined
    ? undefined
    : rustProjectNamedStateType(state.carrier, context);
}

export function projectTypeSubstitutions(
  definition: RustProjectTypeDefinition,
  carrier: TargetTypeRef,
): ReadonlyMap<string, TargetTypeRef> {
  const value = rustSourceTypeCarrierValue(carrier);
  return new Map(definition.typeParameterNames.map((name, index) =>
    [name, value?.typeArguments[index] ?? { kind: "type-parameter", name }] as const));
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

export function rustRcType(inner: RustType): RustType {
  return { kind: "named", path: "std::rc::Rc", typeArguments: [inner] };
}

export function cloneExpression(expression: RustExpr): RustExpr {
  return { kind: "method-call", receiver: expression, method: "clone", args: [] };
}

export function cloneField(receiver: RustExpr, name: string): RustExpr {
  return cloneExpression({ kind: "field", receiver, name });
}
