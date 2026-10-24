import type { Node } from "@tsonic/tsts";
import { rustPackageFallibleBoundary, rustErrorType } from "../../program/fallible-boundaries.js";
import type { RustProjectTypeDefinition } from "../../../../target-model/types/project-types.js";

import type { RustExpr, RustImplFunction, RustType } from "../../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { createRustSyntheticNameState } from "../../names/synthetic.js";
import { planRustConstructionBody } from "../../declarations/classes/construction-body.js";
import { requireRustConstructorContract } from "../../declarations/classes/constructor-contracts.js";
import { planRustCallableParameters } from "../../declarations/callables/parameters.js";
import { rustClassEnvironmentContext, rustClassEnvironmentParameter } from "../class-environments.js";
import { rustErrorBoundaryForDeclaration, type RustPlanContext } from "../../program/plan-context.js";
import { applyFallibleShape } from "../../types/fallible-shape.js";
import { rustDeclarationRequiresUnsafe, rustSafetyAttributesForDeclaration } from "../../safety/explicit-safety.js";
import { rustProjectObjectDispatchField, rustProjectObjectIdentityField, rustProjectObjectStateField } from "../project-objects.js";
import { cloneRustExpression as cloneExpression } from "../../../target-ast/syntax/expressions.js";
import type { ProjectClassStateLayer } from "./model.js";
import { rustProjectStateType } from "./names.js";
import { planRustConstructionLayers } from "./construction-layers.js";
import { planRustImplicitConstructorParameters } from "./construction-parameters.js";

export function planProjectClassConstructor(
  definition: RustProjectTypeDefinition,
  wrapperType: RustType,
  rootType: RustType,
  layers: readonly ProjectClassStateLayer[],
  context: RustPlanContext,
): { readonly construct?: RustImplFunction } | undefined {
  const native = context.input.program.records.nativeClass.get(definition.declaration);
  if (native === undefined) failRustPlannerInvariant("An admitted polymorphic class requires its native declaration plan.", definition.declaration);
  if (native.abstract) return {};
  const plan = context.input.program.records.classConstruction.get(definition.declaration);
  const selected = plan?.layers[plan.layers.length - 1];
  if (plan === undefined || selected === undefined || wrapperType.kind !== "named" || rootType.kind !== "named") {
    failRustPlannerInvariant("Polymorphic construction requires its sealed readiness and native root plan.", definition.declaration);
  }
  const constructor = selected.constructor;
  const safetyDeclaration = constructor ?? definition.declaration;
  const syntheticNames = createRustSyntheticNameState(context.input.program.source.ast, safetyDeclaration, []);
  for (const layer of plan.layers) {
    const layerNames = createRustSyntheticNameState(context.input.program.source.ast, layer.definition.declaration, []);
    for (const name of layerNames.reserved) syntheticNames.reserved.add(name);
  }
  const parameterPlan = constructor === undefined
    ? planRustImplicitConstructorParameters(selected.signature, native.carrier, context)
    : planRustCallableParameters(requireRustConstructorContract(native), context, syntheticNames, "source-body");
  if (parameterPlan === undefined) failRustPlannerInvariant("An admitted native constructor requires its sealed parameters, environment and body.", definition.declaration);
  const environment = native.constructorEnvironment;
  const environmentParameter = environment === undefined ? undefined
    : rustClassEnvironmentParameter(environment, context, "owned");
  if (environment !== undefined && environmentParameter === undefined) failRustPlannerInvariant("An admitted native constructor requires its sealed parameters, environment and body.", definition.declaration);
  const fallible = context.input.program.records.fallible.get(safetyDeclaration) !== undefined;
  const boundary = fallible ? rustErrorBoundaryForDeclaration(safetyDeclaration, context) : undefined;
  if (fallible && boundary === undefined) {
    failRustPlannerInvariant("Native construction requires its exact finalized error boundary.", safetyDeclaration);
  }
  const constructorContext: RustPlanContext = {
    ...(environment === undefined ? context : rustClassEnvironmentContext(environment,
      { kind: "path", path: environment.parameterName }, context)),
    syntheticNames, controlFlow: { nextLoopId: 0 }, functionReturnType: wrapperType,
    functionAbsenceReturnCarrier: undefined,
    fallibleBoundary: boundary === undefined ? undefined : rustPackageFallibleBoundary(boundary),
  };
  const materialize = (values: ReadonlyMap<Node, RustExpr>, retainedIdentity?: RustExpr): RustExpr => {
    let state: RustExpr | undefined;
    for (const layer of layers) {
      const nativeState = rustProjectStateType(layer.carrier, constructorContext);
      if (nativeState?.kind !== "named") failRustPlannerInvariant("Sealed construction lost its native state type.", layer.definition.declaration);
      state = { kind: "associated-call", owner: nativeState, method: "new", args: [
        ...(state === undefined ? [] : [state]),
        ...layer.fields.map(field => values.get(field.declaration)!),
      ] };
    }
    if (state === undefined) failRustPlannerInvariant("Sealed construction lost its physical state lineage.", definition.declaration);
    return { kind: "block", body: { statements: [
      { kind: "let", name: "identity", mutable: false,
        init: retainedIdentity === undefined ? { kind: "call", path: "rt::ObjectIdentity::new", args: [] } : cloneExpression(retainedIdentity) },
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
  const construction = planRustConstructionBody(plan, layers.flatMap(layer => layer.fields),
    wrapperType, materialize, constructorContext);
  if (construction === undefined) failRustPlannerInvariant("An admitted native constructor requires its sealed parameters, environment and body.", definition.declaration);
  const body = planRustConstructionLayers(plan, layers, parameterPlan, construction, constructorContext);
  if (body === undefined) failRustPlannerInvariant("An admitted native constructor requires its sealed parameters, environment and body.", definition.declaration);
  const isUnsafe = rustDeclarationRequiresUnsafe(definition.declaration, "constructor", context.input, constructor);
  const attrs = rustSafetyAttributesForDeclaration(safetyDeclaration, isUnsafe, context.input);
  const deadCode = native.constructorDeadCode;
  return { construct: { kind: "function", name: selected.signature.targetName, generics: emptyRustGenerics,
    ...(isUnsafe ? { isUnsafe: true } : {}), ...(attrs.length === 0 ? {} : { attrs }),
    ...(deadCode === undefined ? {} : { deadCode }),
    visibility: native.constructorVisibility,
    params: [...(environmentParameter === undefined ? [] : [environmentParameter]), ...parameterPlan.params],
    ...(boundary === undefined ? {} : { errorType: rustErrorType(boundary) }), returnType: wrapperType,
    body: applyFallibleShape({ statements: [...construction.declarations, ...body, ...construction.finish()] },
      fallible ? { fallible: true, hasReturnValue: true, errorType: rustErrorType(boundary!),
        inferErrorTypeFromReturnType: true, canFallThrough: false } : { fallible: false, hasReturnValue: true }),
  } };
}
