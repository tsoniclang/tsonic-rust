import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageQueries } from "@tsonic/target-api/analysis";
import { asSourceNode } from "@tsonic/target-api/source";
import { rejectedTargetStage, resolvedTargetStage, type TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustProgramRecords } from "../../../target-model/records/program.js";

import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustCallableProtocol, rustProgramErrorTargetType } from "../../../target-model/types/index.js";
import { rustOnlyTypeGenericArguments } from "../../../target-model/types/generic-arguments.js";
import { rustOptionElementCarrier } from "../../../target-model/types/carriers/optional.js";
import { rustCallableTargetId } from "../../../target-model/types/carriers/source-types.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../../../target-model/metadata/closed-data.js";

import { selectRustPhysicalProgramErrorOwner } from "../../errors/error-types.js";
import type { RustSourcePackageComponentClassifications } from "../../../target-model/records/source-package-semantics.js";
import type { RustNativeCallableInputPlan } from "../native/native-inputs.js";
import type { RustNativeCallableInput } from "../../../target-model/records/native-protocols.js";
import type { RustNativeStoragePlan } from "../storage/native-storage.js";
import { createRustEffectsWorkBudget } from "../../errors/effects-work-budget.js";

export function analyzeRustRetainedCallableInputs(input: {
  readonly ast: AstReader;
  readonly records: RustProgramRecords;
  readonly storage: SourceStorageQueries;
  readonly nativeNodes: readonly Node[];
  readonly native: RustNativeCallableInputPlan;
  readonly nativeStorage: RustNativeStoragePlan;
  readonly components: RustSourcePackageComponentClassifications;
}): TargetStageResult<RustRetainedCallableInputPlan> {
  const budget = createRustEffectsWorkBudget();
  const boundaries = new Map<Node, Map<number, RustRetainedCallableBoundary>>();
  const requirements = new Map<RustNativeCallableInput, Map<string, TargetTypeRef>>();
  const invocations = new Map<Node, Node[]>();
  let unresolved: { readonly node: Node; readonly reason: string } | undefined;
  const pending: { input: RustNativeCallableInput; error: TargetTypeRef }[] = [];
  const owned = new Set(input.native.inputs);
  const add = (selected: RustNativeCallableInput, error: TargetTypeRef): void => {
    budget.step();
    if (!owned.has(selected)) failTargetAnalysisInvariant("tsonic-rust", "Retained callable constraints require their owned native input.");
    const values = requirements.get(selected) ?? new Map<string, TargetTypeRef>();
    const key = closedMetadataKey(error);
    if (values.has(key)) return;
    budget.metadata(error);
    values.set(key, error);
    requirements.set(selected, values);
    pending.push({ input: selected, error });
  };
  const failure = budget.run(() => {
    if (owned.size === 0) return;
    for (const node of input.nativeNodes) {
      budget.step();
      const operation = input.records.targetOperation.get(node);
      if (operation?.kind !== "typed-location") continue;
      const selected = input.records.selectedCall.get(node);
      const owner = selectRustPhysicalProgramErrorOwner(node, input);
      const locationArguments = operation.locationCarrier.kind === "target-named"
        ? rustOnlyTypeGenericArguments(operation.locationCarrier.genericArguments) : undefined;
      if (selected === undefined || owner === undefined || locationArguments?.length !== 2) continue;
      const errorCarrier = snapshotClosedMetadata(rustProgramErrorTargetType(owner));
      for (const [index, parameter] of selected.member.parameters.entries()) {
        budget.step();
        if (rustCallableProtocol(parameter.type) === undefined) continue;
        const argument = input.ast.arguments(node)[index];
        const origins = argument === undefined ? undefined : input.native.originsForValue(argument);
        if (origins?.kind !== "resolved") continue;
        const boundary = Object.freeze({ inputs: Object.freeze([...origins.inputs]), errorCarrier });
        const members = boundaries.get(node) ?? new Map<number, RustRetainedCallableBoundary>();
        members.set(index, boundary);
        boundaries.set(node, members);
        for (const selectedInput of origins.inputs) add(selectedInput, errorCarrier);
      }
    }
    // A native input passed to a native input invocation whose parameter is a type-erased runtime callable is erased
    // into that callable: the input is retained by it and its invocation error converts into the parameter's error.
    for (const call of input.native.calls) {
      budget.step();
      const parameters = rustCallableProtocol(rustOptionElementCarrier(call.input.carrier) ?? call.input.carrier)?.parameters ?? [];
      for (const [index, argument] of input.ast.arguments(call.node).entries()) {
        budget.step();
        const parameter = parameters[index];
        const errorCarrier = parameter?.kind === "target-named" && parameter.id === rustCallableTargetId
          ? rustCallableProtocol(parameter)?.error : undefined;
        const origins = argument === undefined || errorCarrier === undefined ? undefined : input.native.originsForValue(argument);
        if (origins?.kind !== "resolved" || origins.inputs.length !== 1 || origins.implementations.length !== 0) continue;
        const members = boundaries.get(call.node) ?? new Map<number, RustRetainedCallableBoundary>();
        members.set(index, Object.freeze({ inputs: Object.freeze([...origins.inputs]), errorCarrier: errorCarrier! }));
        boundaries.set(call.node, members);
        add(origins.inputs[0]!, errorCarrier!);
      }
    }
    for (const node of input.storage.invocations) {
      budget.step();
      const operation = input.records.targetOperation.get(node);
      if (operation?.kind !== "source-call") continue;
      const selected = input.records.selectedCall.get(node);
      const declaration = asSourceNode(selected?.sourceDeclaration, input.ast);
      if (declaration === undefined) continue;
      const calls = invocations.get(declaration) ?? [];
      calls.push(node);
      invocations.set(declaration, calls);
    }
    for (let index = 0; index < pending.length; index += 1) {
      budget.step();
      const value = pending[index]!;
      for (const invocation of invocations.get(value.input.owner) ?? []) {
        budget.step();
        const selected = input.nativeStorage.invocationInputFor(value.input, invocation);
        if (selected.kind === "unresolved") {
          unresolved = { node: invocation, reason: selected.reason };
          return;
        }
        if (selected.kind === "selected") for (const dependant of selected.inputs) add(dependant, value.error);
      }
    }
  });
  if (failure !== undefined) return rejectedTargetStage([{ ...failure, category: "error", source: "tsonic-rust" }]);
  if (unresolved !== undefined) return rejectedTargetStage([{ code: "RUST_RETAINED_CALLBACK_INPUT_UNRESOLVED",
    category: "error", source: "tsonic-rust", sourceNode: unresolved.node, message: unresolved.reason,
    evidence: ["target.capability=rust.native-callable.retained-input"] }]);
  return resolvedTargetStage(sealRustRetainedCallableInputs(requirements, boundaries));
}

import type { RustRetainedCallableBoundary, RustRetainedCallableInputPlan } from "../../../target-model/records/retained-inputs.js";
import { sealRustRetainedCallableInputs } from "../../program/records/retained-inputs.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
