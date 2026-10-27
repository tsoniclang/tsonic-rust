import type { SourceStorageBindings, SourceStorageSubject } from "@tsonic/target-api/analysis";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { selectRustJsConstructorStoredInputs } from "../../../policy/operations/source-profiles/js/constructors.js";
import type { RustJsStoredTypeArgumentSlot } from "../../../policy/operations/source-profiles/js/stored-slots.js";
import type { createRustNativeStorageQueries } from "./native-storage.js";
import { rustTypeGenericArguments } from "../../../target-model/types/generic-arguments.js";

interface RustNativeCollectionSelection {
  readonly step: (depth: number) => boolean;
  readonly fail: (message: string) => undefined;
  readonly requiresPhysicalSelection: (carrier: TargetTypeRef, depth: number) => boolean | undefined;
  readonly visit: (carrier: TargetTypeRef, subject: SourceStorageSubject, bindings: SourceStorageBindings, depth: number) => TargetTypeRef | undefined;
}

export function selectRustNativeArrayStorage(
  current: Extract<TargetTypeRef, { readonly kind: "target-named" }>,
  elementCarrier: TargetTypeRef,
  subject: SourceStorageSubject,
  bindings: SourceStorageBindings,
  depth: number,
  selection: Pick<RustNativeCollectionSelection, "requiresPhysicalSelection" | "visit"> & {
    readonly project: (subject: SourceStorageSubject, component: SourceStorageSubject["projection"][number]) => SourceStorageSubject | undefined;
  },
): TargetTypeRef | undefined {
  const demand = selection.requiresPhysicalSelection(elementCarrier, depth + 1);
  if (demand === undefined) return undefined;
  if (!demand) return current;
  const component = selection.project(subject, { kind: "array-element" });
  const element = component === undefined ? undefined : selection.visit(elementCarrier, component, bindings, depth + 1);
  return element === undefined ? undefined : element === elementCarrier ? current
    : Object.freeze({ ...current, genericArguments: Object.freeze(rustTypeGenericArguments([element])) });
}

export function selectRustNativeCollectionStorage(
  input: Pick<Parameters<typeof createRustNativeStorageQueries>[0], "ast" | "storage" | "records">,
  current: Extract<TargetTypeRef, { readonly kind: "target-named" }>,
  storedSlots: readonly RustJsStoredTypeArgumentSlot[],
  selectedSubject: SourceStorageSubject,
  bindings: SourceStorageBindings,
  depth: number,
  selection: RustNativeCollectionSelection,
): TargetTypeRef | undefined {
  const { fail, step, requiresPhysicalSelection, visit } = selection;
  const arguments_ = current.genericArguments;
  if (arguments_ === undefined) return fail("Opaque collection storage requires its selected native type arguments.");
  const demands = storedSlots.map(slot => requiresPhysicalSelection(slot.carrier, depth + 1));
  if (demands.some(demand => demand === undefined)) return undefined;
  const callableSlots = storedSlots.filter((_slot, index) => demands[index] === true);
  if (callableSlots.length === 0) return current;
  const producers = input.storage.storageProducersFor(selectedSubject, bindings);
  if (producers.kind === "unresolved") return fail(producers.reason);
  const constructors: {
    readonly producer: (typeof producers.producers)[number];
    readonly storedInputs: ReturnType<typeof selectRustJsConstructorStoredInputs>;
  }[] = [];
  for (const producer of producers.producers) {
    if (!step(depth)) return undefined;
    const subject = producer.subject;
    const operation = subject.kind !== "value" || subject.projection.length !== 0 ||
      !input.ast.is.IsNewExpression(subject.node) ? undefined : input.records.targetOperation.get(subject.node);
    const storedInputs = operation?.kind !== "provider-operation" || operation.resultCarrier.kind !== "target-named" ||
      operation.resultCarrier.id !== current.id ? undefined : selectRustJsConstructorStoredInputs(operation.operationId, current);
    constructors.push({ producer, storedInputs });
  }
  if (producers.kind === "open" && producers.boundaries.some(boundary =>
    boundary.kind !== "opaque-result" || !constructors.some(({ producer, storedInputs }) => {
      if (!step(depth)) return false;
      return storedInputs !== undefined && boundary.subject === producer.subject &&
        boundary.exposure === producer.subject.node && boundary.bindings === producer.bindings;
    }))) return fail("Opaque collection callable storage requires its actual closed native constructor inputs.");
  const elements = new Map<number, TargetTypeRef>();
  for (const { producer, storedInputs } of constructors) {
    if (!step(depth) || producer.subject.kind !== "value" || producer.subject.projection.length !== 0 ||
      !input.ast.is.IsNewExpression(producer.subject.node))
      return fail("Opaque collection callable storage requires one exact checked native constructor occurrence.");
    if (storedInputs === undefined) return fail("Opaque collection callable storage has no selected native constructor payload correspondence.");
    for (const slot of callableSlots) {
      const selectedInput = storedInputs.find(candidate => candidate.nativeArgumentIndex === slot.nativeArgumentIndex);
      const argument = selectedInput === undefined ? undefined : input.ast.arguments(producer.subject.node)[selectedInput.sourceIndex];
      const projected = argument === undefined || selectedInput === undefined ? undefined
        : input.storage.subject(argument, "value", selectedInput.projections);
      if (projected?.kind !== "resolved") return fail(projected?.reason
        ?? "Opaque collection callable storage requires the actual authored constructor payload.");
      const element = visit(slot.carrier, projected.subject, producer.bindings, depth + 1);
      if (element === undefined) return undefined;
      const previous = elements.get(slot.nativeArgumentIndex);
      if (previous !== undefined && !rustTargetTypeRefEquals(previous, element))
        return fail("Opaque collection constructors require one exact shared physical callable payload and invocation error.");
      elements.set(slot.nativeArgumentIndex, element);
    }
  }
  if (callableSlots.some(slot => !elements.has(slot.nativeArgumentIndex)))
    return fail("Opaque collection callable storage has no actual native payload producer.");
  const genericArguments = arguments_.map((argument, index) => {
    const element = elements.get(index);
    return element === undefined ? argument : Object.freeze({ kind: "type" as const, type: element });
  });
  return Object.freeze({ ...current, genericArguments: Object.freeze(genericArguments) });
}
