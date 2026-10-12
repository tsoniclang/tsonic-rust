import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageQueries } from "@tsonic/target-api/analysis";
import { asSourceNode } from "@tsonic/target-api/source";
import { rejectedTargetStage, resolvedTargetStage, type TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustSelectedCallKey } from "../../target-model/facts/selections.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustCallableProtocol, rustProgramErrorTargetType } from "../../target-model/types/index.js";
import { rustOnlyTypeGenericArguments } from "../../target-model/types/generic-arguments.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustTargetOperationFactKey } from "../facts/keys.js";
import { selectRustPhysicalProgramErrorOwner } from "../program/error-types.js";
import type { RustSourcePackageComponentClassifications } from "../program/source-package-components.js";
import type { RustNativeCallableInput, RustNativeCallableInputPlan } from "./native-inputs.js";
import type { RustNativeStoragePlan } from "./native-storage.js";
import { createRustEffectsWorkBudget } from "../resources/effects-work-budget.js";

export interface RustRetainedCallableBoundary {
  readonly inputs: readonly RustNativeCallableInput[];
  readonly errorCarrier: TargetTypeRef;
}

export interface RustRetainedCallableInputPlan {
  forInput(input: RustNativeCallableInput): readonly TargetTypeRef[];
  forBoundary(call: Node, argumentIndex: number): RustRetainedCallableBoundary | undefined;
}

export function analyzeRustRetainedCallableInputs(input: {
  readonly ast: AstReader;
  readonly facts: RustPlanQueries;
  readonly storage: SourceStorageQueries;
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
    if (!owned.has(selected)) throw new Error("Retained callable constraints require their owned native input.");
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
    for (const node of input.storage.nodes) {
      budget.step();
      const operation = input.facts.getFact(node, rustTargetOperationFactKey);
      if (operation?.kind !== "typed-location") continue;
      const selected = input.facts.getFact(node, rustSelectedCallKey);
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
    for (const node of input.storage.invocations) {
      budget.step();
      const operation = input.facts.getFact(node, rustTargetOperationFactKey);
      if (operation?.kind !== "source-call") continue;
      const selected = input.facts.getFact(node, rustSelectedCallKey);
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
  const published = new Map([...requirements].map(([selected, errors]) =>
    [selected, Object.freeze([...errors.values()])] as const));
  const absent: readonly TargetTypeRef[] = Object.freeze([]);
  return resolvedTargetStage(Object.freeze({
    forInput: (selected: RustNativeCallableInput) => published.get(selected) ?? absent,
    forBoundary: (call: Node, index: number) => boundaries.get(call)?.get(index),
  }));
}
