import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { emptyRustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { RustCallableParameterAbi, RustCallableParameterAdapter, RustCallableParameterRead,
  RustCallableRestIteration, RustCallableRestSegment, RustCallableValueAdapter } from "../../target-model/records/callables/callable-adapters.js";
import { callableRestElement } from "../../target-model/records/callables/callable-adapters.js";
import { rustOptionalStorageValue } from "../../target-model/types/projections.js";
import { isDenseDataArray, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isRustStringCarrier, isRustUnitCarrier, rustOptionElementCarrier, rustOptionTargetType } from "../../target-model/types/index.js";
import { isRustCopyCarrier, rustCarrierSupportsClone } from "../constraints/native-traits.js";
import { rustRestSequenceElements } from "../../target-model/operations/rest-assembly.js";
import { rustContextualRuntimeConversionContract, rustCompilerOwnedContextualConversionMatches } from "./contextual.js";
import { rustProjectUnionUpcastRelation } from "../model/project-union-relations.js";
import { selectRustValueCarrierReconciliation } from "./value-carrier-reconciliation.js";

export function selectRustCallableValueAdapter(
  sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef,
  projectTypes: RustProjectTypePolicy,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): RustCallableValueAdapter | undefined {
  if (rustTargetTypeRefEquals(sourceCarrier, targetCarrier))
    return Object.freeze({ kind: "identity", sourceCarrier, targetCarrier, fallible: false });
  const sourceOption = rustOptionElementCarrier(sourceCarrier);
  const targetOption = rustOptionElementCarrier(targetCarrier);
  if (targetOption !== undefined && isRustUnitCarrier(sourceCarrier))
    return Object.freeze({ kind: "absent-completion", sourceCarrier, targetCarrier, fallible: false });
  if (targetOption !== undefined && sourceOption === undefined) {
    const element = selectRustCallableValueAdapter(sourceCarrier, targetOption, projectTypes, definitions);
    return element === undefined ? undefined
      : Object.freeze({ kind: "option-some", sourceCarrier, targetCarrier, element, fallible: element.fallible });
  }
  if (sourceOption !== undefined && targetOption !== undefined) {
    const element = selectRustCallableValueAdapter(sourceOption, targetOption, projectTypes, definitions);
    return element === undefined ? undefined
      : Object.freeze({ kind: "option-map", sourceCarrier, targetCarrier, element, fallible: element.fallible,
        lowering: rustOptionalStorageValue(sourceCarrier) !== undefined || rustOptionalStorageValue(targetCarrier) !== undefined ? "branch" : "native-option" });
  }
  const selected = selectRustValueCarrierReconciliation(sourceCarrier, targetCarrier, projectTypes, definitions);
  switch (selected.kind) {
    case "identity":
      return Object.freeze({ kind: "identity", sourceCarrier, targetCarrier: sourceCarrier, fallible: false });
    case "conversion": {
      const conversion = selected.fact.conversion;
      const source = selected.upcast?.targetCarrier ?? sourceCarrier;
      const target = selected.fact.targetCarrier;
      const native = rustContextualRuntimeConversionContract(conversion, definitions);
      if (native !== undefined) {
        if (!rustTargetTypeRefEquals(native.source, source) || !rustTargetTypeRefEquals(native.target, target)) return undefined;
        return Object.freeze({ kind: "conversion", sourceCarrier, targetCarrier: target, conversion,
          fallible: native.fallible, lowering: Object.freeze({ kind: "native", contract: snapshotClosedMetadata(native) }),
          ...(selected.upcast === undefined ? {} : { upcast: selected.upcast }) });
      }
      if (conversion.kind === "provider-record-copy" || conversion.kind === "integer-truncation" ||
        !rustCompilerOwnedContextualConversionMatches(source, target, conversion, definitions,
          rustProjectUnionUpcastRelation(projectTypes))) return undefined;
      return Object.freeze({ kind: "conversion", sourceCarrier, targetCarrier: target, conversion,
        fallible: false, lowering: Object.freeze({ kind: "compiler" }),
        ...(selected.upcast === undefined ? {} : { upcast: selected.upcast }) });
    }
    case "project-upcast":
      return Object.freeze({ kind: "project-upcast", sourceCarrier, targetCarrier: selected.fact.targetCarrier, fallible: false });
    case "call-scoped-lifetime":
      return Object.freeze({ kind: "call-scoped-lifetime", sourceCarrier, targetCarrier: selected.fact.selectedCarrier, fallible: false });
    case "incompatible":
      return undefined;
  }
}

export function selectRustCallableParameterAdapters(
  contractParameters: readonly RustCallableParameterAbi[],
  implementationParameters: readonly RustCallableParameterAbi[],
  projectTypes: RustProjectTypePolicy,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): readonly RustCallableParameterAdapter[] | undefined {
  const wellFormed = (parameters: readonly RustCallableParameterAbi[]) => isDenseDataArray(parameters) &&
    parameters.every((parameter, index) => parameter !== null && typeof parameter === "object" &&
      ["required", "optional", "default", "rest"].includes(parameter.form) &&
      ["value", "ref", "mut-ref"].includes(parameter.mode) &&
      isRustTargetTypeRef(parameter.valueCarrier) && isRustTargetTypeRef(parameter.parameterCarrier) &&
      (parameter.form !== "rest" || index === parameters.length - 1 &&
        parameter.mode === "value" && callableRestElement(parameter.parameterCarrier) !== undefined));
  if (!wellFormed(contractParameters) || !wellFormed(implementationParameters)) return undefined;
  const readFor = (source: RustCallableParameterAbi): RustCallableParameterRead | undefined => source.mode === "value" ? "value"
    : isRustStringCarrier(source.valueCarrier) ? "owned-string" : isRustCopyCarrier(source.valueCarrier) ? "copy"
      : rustCarrierSupportsClone(source.valueCarrier, definitions) ? "clone" : undefined;
  const iterationFor = (source: RustCallableParameterAbi, mutable: boolean): RustCallableRestIteration | undefined => {
    const sequence = rustRestSequenceElements(source.parameterCarrier);
    const element = callableRestElement(source.parameterCarrier);
    if (element === undefined || sequence?.collection !== "vec" && sequence?.collection !== "js-array") return undefined;
    return Object.freeze({ collection: sequence.collection, elementCarrier: element, mutable,
      cloneRequirement: sequence.collection === "js-array" && !rustCarrierSupportsClone(element, definitions) ? element : undefined });
  };
  const adapters: RustCallableParameterAdapter[] = [];
  let sourceIndex = 0;
  let restOffset = 0;
  for (const target of implementationParameters) {
    const source = contractParameters[sourceIndex];
    const runtimeAdapter = source === undefined ? undefined
      : selectRustCallableValueAdapter(source.parameterCarrier, target.parameterCarrier, projectTypes, definitions);
    if (source !== undefined && restOffset === 0 && runtimeAdapter !== undefined &&
      (source.form === "rest") === (target.form === "rest") &&
      (source.mode === target.mode || source.mode === "mut-ref" && target.mode === "ref")) {
      adapters.push(Object.freeze({ kind: "runtime-value", contractParameterIndex: sourceIndex++, source, target,
        adapter: runtimeAdapter, fallible: runtimeAdapter.fallible }));
      continue;
    }
    if (target.form === "rest") {
      const sequence = rustRestSequenceElements(target.parameterCarrier);
      const element = callableRestElement(target.parameterCarrier);
      if (element === undefined || sequence?.collection !== "vec" && sequence?.collection !== "js-array") return undefined;
      const segments: RustCallableRestSegment[] = [];
      for (; sourceIndex < contractParameters.length; sourceIndex += 1) {
        const source = contractParameters[sourceIndex]!;
        const sourceElement = source.form === "rest" ? callableRestElement(source.parameterCarrier) : source.valueCarrier;
        const adapter = sourceElement === undefined ? undefined
          : selectRustCallableValueAdapter(sourceElement, element, projectTypes, definitions);
        if (adapter === undefined || source.form !== "required" && source.form !== "rest") return undefined;
        if (source.form === "rest") {
          const iteration = iterationFor(source, restOffset > 0);
          if (iteration === undefined) return undefined;
          segments.push(Object.freeze({ kind: "sequence", contractParameterIndex: sourceIndex, source,
            offset: restOffset, adapter, iteration }));
        } else {
          const read = readFor(source);
          if (read === undefined) return undefined;
          segments.push(Object.freeze({ kind: "value", contractParameterIndex: sourceIndex, source, adapter, read }));
        }
      }
      adapters.push(Object.freeze({ kind: "rest", segments: Object.freeze(segments), target,
        elementCarrier: element, collection: sequence.collection, fallible: segments.some(segment => segment.adapter.fallible) }));
      continue;
    }
    if (source === undefined) {
      if (target.form !== "optional" && target.form !== "default") return undefined;
      adapters.push(Object.freeze({ kind: "omitted", target, fallible: false }));
      continue;
    }
    if (source.form !== "required" && source.form !== "rest" ||
      source.mode !== "value" && !isRustCopyCarrier(source.valueCarrier) && !rustCarrierSupportsClone(source.valueCarrier, definitions)) return undefined;
    const targetLogicalCarrier = target.form === "optional" ? rustOptionElementCarrier(target.parameterCarrier) : target.valueCarrier;
    const sourceLogicalCarrier = source.form === "rest" ? callableRestElement(source.parameterCarrier) : source.valueCarrier;
    const adapter = targetLogicalCarrier === undefined || sourceLogicalCarrier === undefined ? undefined
      : selectRustCallableValueAdapter(sourceLogicalCarrier, targetLogicalCarrier, projectTypes, definitions);
    if (adapter === undefined) return undefined;
    if (source.form === "rest") {
      const iteration = iterationFor(source, true);
      if (iteration === undefined) return undefined;
      const optional = target.form === "optional" || target.form === "default";
      const optionalAdapter: RustCallableValueAdapter | undefined = optional && adapter.kind !== "identity"
        ? Object.freeze({ kind: "option-map", sourceCarrier: rustOptionTargetType(adapter.sourceCarrier),
            targetCarrier: target.parameterCarrier, element: adapter, fallible: adapter.fallible,
            lowering: rustOptionalStorageValue(target.parameterCarrier) !== undefined ? "branch" : "native-option" }) : undefined;
      adapters.push(Object.freeze({ kind: "rest-element", contractParameterIndex: sourceIndex, source,
        offset: restOffset++, target, adapter, iteration, optionalAdapter, fallible: adapter.fallible }));
    } else {
      const read = readFor(source);
      if (read === undefined) return undefined;
      adapters.push(Object.freeze({ kind: "logical-value", contractParameterIndex: sourceIndex++, source,
        target, adapter, read, fallible: adapter.fallible }));
    }
  }
  return snapshotClosedMetadata(adapters);
}
