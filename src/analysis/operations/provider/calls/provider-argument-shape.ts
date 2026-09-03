import { rustTargetGenericReferences } from "../../../../target-model/types/index.js";
import type {
  RustArgumentMode,
  RustProviderFactOperationKind,
  RustProviderOperationForm,
  RustProviderOperationTemplate,
  RustRuntimeSetOperationKind,
} from "../../../facts/keys.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";

export function rustProviderSourceArgumentMode(
  form: RustProviderOperationForm,
  sourceIndex: number,
): RustArgumentMode | undefined {
  const orderedMode = (
    modes: readonly RustArgumentMode[] | undefined,
    order: readonly number[] | undefined,
  ) => {
    const targetIndex = order === undefined ? sourceIndex : order.indexOf(sourceIndex);
    return targetIndex < 0 ? undefined : modes?.[targetIndex] ?? "value";
  };
  switch (form.form) {
    case "struct-variant":
    case "expression-macro":
      return "value";
    case "call":
    case "source-module-construction":
    case "free-call":
    case "receiver-method":
      return orderedMode(form.argModes, form.argOrder);
    case "trait-call":
      return form.argModes?.[sourceIndex] ?? "value";
    case "call-c-variadic":
      return form.fixedArgumentModes[sourceIndex] ?? "value";
    default:
      return undefined;
  }
}

export function rustBorrowedStringTypeParameterNames(
  template: RustProviderOperationTemplate<RustProviderFactOperationKind | RustRuntimeSetOperationKind>,
): ReadonlySet<string> {
  const candidates = new Set((template.genericParameters ?? []).flatMap((parameter) =>
    parameter.kind === "type" && parameter.maybeSized === true ? [parameter.sourceName] : []));
  if (candidates.size === 0) return candidates;
  const disallowReferenced = (carrier: TargetTypeRef | undefined): void => {
    if (carrier === undefined) return;
    for (const name of rustTargetGenericReferences(carrier).typeNames) {
      candidates.delete(name);
    }
  };
  disallowReferenced(template.receiverCarrier);
  disallowReferenced(template.resultCarrier);
  disallowReferenced(template.sourceResultCarrier);
  disallowReferenced(template.sourceAbsenceCarrier);
  const borrowedOccurrences = new Set<string>();
  for (const [index, carrier] of (template.parameterCarriers ?? []).entries()) {
    if (carrier === undefined) continue;
    for (const name of rustTargetGenericReferences(carrier).typeNames) {
      if (carrier.kind !== "type-parameter" || carrier.name !== name ||
          rustProviderSourceArgumentMode(template.target, index) !== "ref") {
        candidates.delete(name);
      } else {
        borrowedOccurrences.add(name);
      }
    }
  }
  for (const name of candidates) {
    if (!borrowedOccurrences.has(name)) candidates.delete(name);
  }
  return candidates;
}
