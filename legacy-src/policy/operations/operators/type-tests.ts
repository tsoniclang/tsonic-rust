import type { RustProjectTypePolicy } from "../../../target-model/types/project-types.js";
import { isRustJsArrayValueCarrier } from "../../../target-model/types/carriers/array-values.js";
import type { RustClosedTypePredicate, RustClosedTypeTestPlan, RustProjectTypeTestPlan } from "../../../target-model/operations/type-tests.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustUnionAlternatives } from "../../../target-model/types/union-relations.js";
import { isRustAbsenceCarrier, isRustJsArrayCarrier, isRustVecCarrier, isRustJsValueCarrier, isRustProgramErrorCarrier,
  rustOptionElementCarrier, rustStructuralObjectCarrierValue, rustTsValueTargetType,
} from "../../../target-model/types/index.js";
import { rustNamedTypeCarrierValue } from "../../../target-model/types/carriers/native.js";
import { getRustTypeofRuntimeKind } from "../../../target-model/types/runtime-kind.js";
import { isRustSourceErrorCarrier } from "../../../target-model/types/carriers/source-error.js";
import { rustCarrierProvidesErrorObservation } from "../../../target-model/types/carriers/error-protocols.js";
import { isRustClosedValueCarrier } from "../../../target-model/types/carriers/closed-value-kind.js";

export function selectRustProjectTypeTestPlan(
  sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef,
  projectTypes: RustProjectTypePolicy,
): RustProjectTypeTestPlan | undefined {
  const dispatchCarrier = rustOptionElementCarrier(sourceCarrier) ?? sourceCarrier;
  const sourceDefinition = projectTypes.definitionForCarrier(dispatchCarrier);
  const targetDefinition = projectTypes.definitionForCarrier(targetCarrier);
  if ((isRustClosedValueCarrier(dispatchCarrier) || isRustProgramErrorCarrier(dispatchCarrier)) &&
    targetDefinition?.kind === "class" && targetDefinition.genericParameters.length === 0 &&
    !projectTypes.sourceErrorDefinitions.includes(targetDefinition) &&
    rustTargetTypeRefEquals(projectTypes.openCarrier(targetDefinition), targetCarrier)) {
    return Object.freeze({ sourceCarrier, dispatchCarrier, targetCarrier,
      lowering: Object.freeze({ kind: "closed-native" }) });
  }
  if (sourceDefinition === undefined || targetDefinition?.kind !== "class") return undefined;
  const sourceToTarget = projectTypes.relationship(dispatchCarrier, targetDefinition);
  const concreteTypes = projectTypes.concreteClassesFor(sourceDefinition);
  const ancestryProven = projectTypes.classLineage(sourceDefinition)?.includes(targetDefinition) === true &&
    concreteTypes.length > 0 && concreteTypes.every(concrete =>
      projectTypes.classLineage(concrete)?.includes(targetDefinition) === true);
  let lowering: RustProjectTypeTestPlan["lowering"];
  if (ancestryProven && sourceToTarget.kind === "related" && rustTargetTypeRefEquals(sourceToTarget.targetType, targetCarrier)) {
    lowering = rustOptionElementCarrier(sourceCarrier) === undefined
      ? { kind: "constant", value: true } : { kind: "option-presence" };
  } else {
    const targetToSource = projectTypes.relationship(targetCarrier, sourceDefinition);
    if (targetToSource.kind === "ambiguous" || sourceToTarget.kind === "ambiguous") return undefined;
    if (projectTypes.downcastRoute(sourceDefinition, targetCarrier) !== undefined) lowering = { kind: "dispatch" };
    else if (targetToSource.kind === "related" && rustTargetTypeRefEquals(targetToSource.targetType, dispatchCarrier)) return undefined;
    else lowering = { kind: "constant", value: false };
  }
  return Object.freeze({ sourceCarrier, dispatchCarrier, targetCarrier, lowering: Object.freeze(lowering) });
}

export function selectRustClosedTypeTestPlan(
  source: TargetTypeRef,
  predicate: RustClosedTypePredicate,
  projectTypes: RustProjectTypePolicy,
  definitions: RustTypeDefinitions,
  ancestors: readonly TargetTypeRef[] = [],
): RustClosedTypeTestPlan | undefined {
  if (ancestors.some(ancestor => rustTargetTypeRefEquals(ancestor, source))) return undefined;
  const nextAncestors = [...ancestors, source];
  const optional = rustOptionElementCarrier(source);
  if (optional !== undefined) {
    const test = selectRustClosedTypeTestPlan(optional, predicate, projectTypes, definitions, nextAncestors);
    return test === undefined ? undefined : Object.freeze({ kind: "option", element: optional, test });
  }
  const alternatives = rustUnionAlternatives(source, definitions);
  if (alternatives !== undefined) {
    const arms = alternatives.map(arm => {
      const test = selectRustClosedTypeTestPlan(arm.carrier, predicate, projectTypes, definitions, nextAncestors);
      return test === undefined ? undefined : Object.freeze({ ...arm, test });
    });
    return arms.length === 0 || arms.some(arm => arm === undefined) ? undefined
      : Object.freeze({ kind: "union", arms: Object.freeze(arms as NonNullable<typeof arms[number]>[]) });
  }
  if (predicate.kind === "array") {
    if (isRustJsValueCarrier(source)) return Object.freeze({ kind: "runtime-array" });
    if (source.kind === "array" || source.kind === "tuple" || isRustJsArrayCarrier(source) || isRustJsArrayValueCarrier(source) || isRustVecCarrier(source)) {
      return Object.freeze({ kind: "constant", value: true });
    }
    return isRustAbsenceCarrier(source) || getRustTypeofRuntimeKind(source, definitions) !== undefined ||
      projectTypes.definitionForCarrier(source) !== undefined || rustStructuralObjectCarrierValue(source) !== undefined
      ? Object.freeze({ kind: "constant", value: false }) : undefined;
  }
  if (predicate.kind === "error") {
    if (!isRustSourceErrorCarrier(source) && rustCarrierProvidesErrorObservation(source, definitions)) {
      return Object.freeze({ kind: "error", lowering: "native-error" });
    }
    if (isRustClosedValueCarrier(source)) return Object.freeze({ kind: "error", lowering: "closed-value" });
    if (isRustProgramErrorCarrier(source) || isRustSourceErrorCarrier(source)) return Object.freeze({ kind: "error", lowering: "program-error" });
    if (rustTargetTypeRefEquals(source, rustTsValueTargetType()) || source.kind === "type-parameter" ||
      source.kind === "associated-type" || source.kind === "trait-object" || source.kind === "reference") return undefined;
    const definition = projectTypes.definitionForCarrier(source);
    if (definition?.kind === "class" && projectTypes.inheritedExternalBaseForDefinition(definition)?.base.programError === true) {
      return Object.freeze({ kind: "error", lowering: "native-error" });
    }
    if (definition !== undefined && projectTypes.concreteClassesFor(definition).some(candidate =>
      projectTypes.inheritedExternalBaseForDefinition(candidate)?.base.programError === true)) return undefined;
    return isRustAbsenceCarrier(source) || getRustTypeofRuntimeKind(source, definitions) !== undefined ||
      definition !== undefined || rustStructuralObjectCarrierValue(source) !== undefined
      ? Object.freeze({ kind: "constant", value: false }) : undefined;
  }
  const target = predicate.targetCarrier;
  const closedProject = selectRustProjectTypeTestPlan(source, target, projectTypes);
  if (closedProject?.lowering.kind === "closed-native") {
    return Object.freeze({ kind: "project", plan: closedProject });
  }
  if (source.kind === "type-parameter" || source.kind === "associated-type" ||
    source.kind === "trait-object" || source.kind === "reference" ||
    isRustJsValueCarrier(source) || rustTargetTypeRefEquals(source, rustTsValueTargetType()) || isRustProgramErrorCarrier(source) ||
    rustStructuralObjectCarrierValue(source) !== undefined) return undefined;
  const sourceDefinition = projectTypes.definitionForCarrier(source);
  const targetDefinition = projectTypes.definitionForCarrier(target);
  if (sourceDefinition !== undefined && targetDefinition !== undefined) {
    const plan = selectRustProjectTypeTestPlan(source, target, projectTypes);
    return plan === undefined ? undefined : Object.freeze({ kind: "project", plan });
  }
  if (sourceDefinition !== undefined && projectTypes.externalBaseForDefinition(sourceDefinition) !== undefined) return undefined;
  if (isRustAbsenceCarrier(source) || source.kind === "source-primitive") return Object.freeze({ kind: "constant", value: false });
  const native = rustNamedTypeCarrierValue(source);
  if (sourceDefinition === undefined && native === undefined && getRustTypeofRuntimeKind(source, definitions) === undefined) return undefined;
  const upcasts = native?.upcasts.filter(upcast => rustTargetTypeRefEquals(upcast.target, target)) ?? [];
  if (upcasts.length > 1) return undefined;
  return Object.freeze({ kind: "constant", value: rustTargetTypeRefEquals(source, target) || upcasts.length === 1 });
}
