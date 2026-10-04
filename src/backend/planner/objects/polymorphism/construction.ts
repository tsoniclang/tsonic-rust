import type { Node } from "@tsonic/tsts";
import type { RustProjectTypeDefinition, RustProjectConstructorSignature } from "../../../../analysis/project-types/type-policy.js";
import { rustFallibleFactKey, rustSourceParameterAbiFactKey } from "../../../../analysis/facts/keys.js";
import { rustTargetIdentifier } from "../../../../target-model/names/identifiers.js";
import type { RustExpr, RustFunctionParam, RustImplFunction, RustType } from "../../../target-ast/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { createRustSyntheticNameState } from "../../names/synthetic.js";
import { planRustConstructionBody } from "../../declarations/classes/construction-body.js";
import { planRustCallableParameters } from "../../declarations/callables/parameters.js";
import { rustClassEnvironmentContext, rustClassEnvironmentParameter } from "../class-environments.js";
import { diagnosticInput, rustErrorBoundaryForDeclaration, rustErrorType,
  rustProjectTypeHasPublicImplementationAbi, isValidRustIdentifier, type RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { applyFallibleShape } from "../../types/fallible-shape.js";
import { rustDeclarationRequiresUnsafe, rustSafetyAttributesForDeclaration } from "../../safety/explicit-safety.js";
import { rustProjectConstructorDeadCodeDisposition } from "../../liveness/directives.js";
import { rustProjectObjectDispatchField, rustProjectObjectIdentityField, rustProjectObjectStateField } from "../project-objects.js";
import { cloneExpression, type ProjectClassStateLayer } from "./model.js";
import { rustProjectStateType } from "./names.js";
import { planRustConstructionLayers } from "./construction-layers.js";

export function planProjectClassConstructor(
  definition: RustProjectTypeDefinition,
  wrapperType: RustType,
  rootType: RustType,
  layers: readonly ProjectClassStateLayer[],
  context: RustPlanContext,
): { readonly construct?: RustImplFunction } | undefined {
  if (context.input.program.source.ast.hasModifierKind(definition.declaration, "abstract")) return {};
  const plan = context.input.program.projectConstructions.forDefinition(definition);
  const selected = plan?.layers[plan.layers.length - 1];
  if (plan === undefined || selected === undefined || wrapperType.kind !== "named" || rootType.kind !== "named") {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, definition.declaration),
      "rust.backend.constructor-plan", "Polymorphic construction has no sealed readiness and native root plan."));
    return undefined;
  }
  const constructor = selected.constructor;
  const safetyDeclaration = constructor ?? definition.declaration;
  const syntheticNames = createRustSyntheticNameState(context.input.program.source.ast, safetyDeclaration, []);
  for (const layer of plan.layers) {
    const layerNames = createRustSyntheticNameState(context.input.program.source.ast, layer.definition.declaration, []);
    for (const name of layerNames.reserved) syntheticNames.reserved.add(name);
  }
  const parameterPlan = constructor === undefined
    ? planImplicitProjectConstructorParameters(definition, selected.signature, context)
    : planRustCallableParameters(constructor, context, syntheticNames);
  if (parameterPlan === undefined) return undefined;
  const environmentSelection = context.input.program.classValues.forDeclaration(definition.declaration)?.environment;
  const environment = environmentSelection?.instancesUseEnvironment || environmentSelection?.initializationUsesEnvironment
    ? environmentSelection : undefined;
  const environmentParameter = environment === undefined ? undefined
    : rustClassEnvironmentParameter(definition.declaration, context, "owned");
  if (environment !== undefined && environmentParameter === undefined) return undefined;
  const fallible = context.input.program.facts.getFact(safetyDeclaration, rustFallibleFactKey) !== undefined;
  const boundary = fallible ? rustErrorBoundaryForDeclaration(safetyDeclaration, context) : undefined;
  if (fallible && boundary === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, safetyDeclaration),
      "rust.backend.constructor-error-boundary", "Native constructor has no exact finalized error boundary."));
    return undefined;
  }
  const constructorContext: RustPlanContext = {
    ...(environment === undefined ? context : rustClassEnvironmentContext(environment,
      { kind: "path", path: environment.parameterName }, context)),
    syntheticNames, controlFlow: { nextLoopId: 0 }, functionReturnType: wrapperType,
    functionAbsenceReturnCarrier: undefined,
    ...(boundary === undefined ? {} : { fallibleBoundary: boundary }),
  };
  const carrier = context.input.program.projectTypes.openCarrier(definition);
  const materialize = (values: ReadonlyMap<Node, RustExpr>): RustExpr => {
    let state: RustExpr | undefined;
    for (const layer of layers) {
      const nativeState = rustProjectStateType(layer.carrier, constructorContext);
      if (nativeState?.kind !== "named") throw new Error("Sealed construction lost its native state type.");
      state = { kind: "associated-call", owner: nativeState, method: "new", args: [
        ...(state === undefined ? [] : [state]),
        ...layer.fields.map(field => values.get(field.declaration)!),
      ] };
    }
    if (state === undefined) throw new Error("Sealed construction lost its physical state lineage.");
    return { kind: "block", body: { statements: [
      { kind: "let", name: "identity", mutable: false,
        init: { kind: "call", path: "rt::ObjectIdentity::new", args: [] } },
      { kind: "tail", expr: { kind: "struct-literal", path: wrapperType.path, fields: [
        { name: rustProjectObjectIdentityField, value: cloneExpression({ kind: "path", path: "identity" }) },
        { name: rustProjectObjectDispatchField, value: { kind: "call", path: "alloc::rc::Rc::new", args: [{
          kind: "struct-literal", path: rootType.path, fields: [
            ...(!environment?.instancesUseEnvironment ? [] : [{
              name: environment.instanceFieldName, value: { kind: "path" as const, path: environment.parameterName },
            }]),
            { name: rustProjectObjectIdentityField, value: { kind: "path", path: "identity" } },
            { name: rustProjectObjectStateField, value: { kind: "call", path: "rt::ObjectState::new", args: [state] } },
          ],
        }] } },
      ] } },
    ] } };
  };
  const construction = planRustConstructionBody(plan, layers.flatMap(layer => layer.fields), carrier,
    wrapperType, materialize, constructorContext);
  if (construction === undefined) return undefined;
  const body = planRustConstructionLayers(plan, layers, parameterPlan, construction, constructorContext);
  if (body === undefined) return undefined;
  const isUnsafe = rustDeclarationRequiresUnsafe(definition.declaration, "constructor", context.input, constructor);
  const attrs = rustSafetyAttributesForDeclaration(safetyDeclaration, isUnsafe, context.input);
  const publiclyReachable = rustProjectTypeHasPublicImplementationAbi(context, definition.targetPath);
  const deadCode = rustProjectConstructorDeadCodeDisposition(context, definition.declaration, safetyDeclaration, publiclyReachable);
  return { construct: { kind: "function", name: selected.signature.targetName, generics: emptyRustGenerics,
    ...(isUnsafe ? { isUnsafe: true } : {}), ...(attrs.length === 0 ? {} : { attrs }),
    ...(deadCode === undefined ? {} : { deadCode }),
    visibility: constructor === undefined || !context.input.program.source.ast.hasModifierKind(constructor, "private") &&
      !context.input.program.source.ast.hasModifierKind(constructor, "protected") ? "public" : "private",
    params: [...(environmentParameter === undefined ? [] : [environmentParameter]), ...parameterPlan.params],
    ...(boundary === undefined ? {} : { errorType: rustErrorType(boundary) }), returnType: wrapperType,
    body: applyFallibleShape({ statements: [...construction.declarations, ...body, ...construction.finish()] },
      fallible ? { fallible: true, hasReturnValue: true, errorType: rustErrorType(boundary!),
        inferErrorTypeFromReturnType: true } : { fallible: false, hasReturnValue: true }),
  } };
}

function planImplicitProjectConstructorParameters(
  definition: RustProjectTypeDefinition,
  signature: RustProjectConstructorSignature,
  context: RustPlanContext,
): {
  readonly params: readonly RustFunctionParam[];
  readonly prelude: readonly never[];
} | undefined {
  const receiver = context.input.program.projectTypes.openCarrier(definition);
  const params: RustFunctionParam[] = [];
  for (const parameter of signature.parameters) {
    const abi = context.input.program.facts.getFact(
      parameter.parameterDeclaration,
      rustSourceParameterAbiFactKey,
    );
    const carrier = abi === undefined
      ? undefined
      : context.input.program.projectTypes.instantiateMemberCarrier(
          parameter.parameterDeclaration,
          receiver,
          abi.parameterCarrier,
        );
    const type = rustTypeFromCarrierInContext(carrier, context);
    const name = rustTargetIdentifier(parameter.parameterName);
    if (type === undefined || !isValidRustIdentifier(name)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, parameter.parameterDeclaration),
        "rust.backend.project-implicit-constructor-parameter",
        "An inherited effective constructor parameter has no exact instantiated Rust ABI.",
      ));
      return undefined;
    }
    params.push({ name, type, mutable: false });
  }
  return { params, prelude: [] };
}
