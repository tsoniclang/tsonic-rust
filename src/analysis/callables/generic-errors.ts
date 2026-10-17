import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import type { RustNativeErrorSource } from "../../target-model/types/native-error-joins.js";
import type { RustSourceCallEffectsFact } from "../../target-model/records/object-methods.js";
import type { RustGenericCallableEffectsFact } from "../../target-model/records/generic-callable-effects.js";
import type { RustGenericCallablePhysicalDefinition, RustGenericCallablePhysicalMember } from "./generic-physical.js";
import type { RustNativeCallableProducerPlan } from "./native-producers.js";
import type { RustGenericCallableBindingContext } from "./generic-bindings.js";
import { createRustEffectsWorkBudget } from "../resources/effects-work-budget.js";
import { rejectedTargetStage, resolvedTargetStage, type TargetStageResult } from "@tsonic/target-api/artifacts";
import { publishRustNativeErrorSources } from "../errors/regions.js";
import type { RustNativeTypeSelectionInput } from "../../policy/types/model/native-type-selection.js";

export interface RustGenericCallableErrorIndex<Source extends RustNativeErrorSource<TargetTypeRef> =
  RustNativeErrorSource<TargetTypeRef> & { readonly nativeType: TargetTypeRef }> {
  forDefinition(definition: RustGenericCallablePhysicalDefinition): RustGenericCallableErrorSelection<Source> | undefined;
}

export function analyzeRustGenericCallableErrors(
  input: Parameters<typeof selectRustGenericCallableErrors>[1],
): TargetStageResult<RustGenericCallableErrorIndex<RustNativeErrorSource<TargetTypeRef>>> {
  const budget = createRustEffectsWorkBudget();
  const selections = new Map<RustGenericCallablePhysicalDefinition, RustGenericCallableErrorSelection<RustNativeErrorSource<TargetTypeRef>>>();
  const failure = budget.run(() => {
    for (const definition of input.physical.definitions()) {
      budget.step();
      if (definition.members.length !== 0) budget.step(definition.members.length);
      const selection = selectRustGenericCallableErrors(definition, input);
      if (selection !== undefined) {
        for (const source of [...selection.invocation, ...selection.awaiting]) budget.metadata(source);
        selections.set(definition, selection);
      }
    }
  });
  return failure === undefined ? resolvedTargetStage(Object.freeze({
    forDefinition: (definition: RustGenericCallablePhysicalDefinition) => selections.get(definition),
  })) : rejectedTargetStage([{ ...failure, category: "error", source: "tsonic-rust" }]);
}

export interface RustGenericCallableMemberErrors<Source extends RustNativeErrorSource<TargetTypeRef> =
  RustNativeErrorSource<TargetTypeRef> & { readonly nativeType: TargetTypeRef }> {
  readonly effects: RustSourceCallEffectsFact;
  readonly invocation: Source | undefined;
  readonly awaiting: Source | undefined;
}

export interface RustGenericCallableErrorSelection<Source extends RustNativeErrorSource<TargetTypeRef> =
  RustNativeErrorSource<TargetTypeRef> & { readonly nativeType: TargetTypeRef }> {
  readonly effects: RustGenericCallableEffectsFact;
  readonly invocation: readonly Source[];
  readonly awaiting: readonly Source[];
  forMember(member: RustGenericCallablePhysicalMember): RustGenericCallableMemberErrors<Source> | undefined;
}

export function selectRustGenericCallableErrors(
  definition: RustGenericCallablePhysicalDefinition,
  input: RustGenericCallableBindingContext & {
    readonly producers: RustNativeCallableProducerPlan;
    readonly effectsFor: (declaration: Node) => RustSourceCallEffectsFact | undefined;
  },
): RustGenericCallableErrorSelection<RustNativeErrorSource<TargetTypeRef>> | undefined {
  const invocation: RustNativeErrorSource<TargetTypeRef>[] = [];
  const awaiting: RustNativeErrorSource<TargetTypeRef>[] = [];
  const selections = new Map<RustGenericCallablePhysicalMember, RustGenericCallableMemberErrors<RustNativeErrorSource<TargetTypeRef>>>();
  for (const member of definition.members) {
    const declaration = member.implementation.declaration;
    const effects = input.effectsFor(declaration);
    const bindings = member.bindings;
    const producer = input.producers.forDeclaration(declaration);
    if (effects === undefined || bindings === undefined || producer === undefined) return undefined;
    const selected: { invocation: RustNativeErrorSource<TargetTypeRef> | undefined;
      awaiting: RustNativeErrorSource<TargetTypeRef> | undefined } = { invocation: undefined, awaiting: undefined };
    for (const channel of ["invocation", "awaiting"] as const) {
      if (effects[channel] !== "fallible") continue;
      const error = input.producers.errorFor(declaration, channel === "invocation" ? "invoke" : 0);
      if (error === undefined) return undefined;
      const sources = channel === "invocation" ? invocation : awaiting;
      const source = Object.freeze({ identity: `${definition.identity}:${member.variantName}:${producer.identity}:${channel}`,
        variant: `Error${sources.length}`,
        errorType: substituteRustTargetGenerics(error, bindings.types, bindings.lifetimes, bindings.consts) });
      sources.push(source);
      selected[channel] = source;
    }
    selections.set(member, Object.freeze({ effects, ...selected }));
  }
  return Object.freeze({ invocation: Object.freeze(invocation), awaiting: Object.freeze(awaiting),
    effects: Object.freeze({ invocation: invocation.length > 0 ? "fallible" : "infallible",
      awaiting: awaiting.length > 0 ? "fallible" : [...selections.values()].some(value => value.effects.awaiting !== "not-applicable")
        ? "infallible" : "not-applicable" }),
    forMember: (member: RustGenericCallablePhysicalMember) => selections.get(member),
  });
}

export function publishRustGenericCallableErrors(
  preparations: RustGenericCallableErrorIndex<RustNativeErrorSource<TargetTypeRef>>,
  definitions: readonly RustGenericCallablePhysicalDefinition[],
  nativeTypeInputFor: (fileName: string) => RustNativeTypeSelectionInput,
): TargetStageResult<RustGenericCallableErrorIndex> {
  const selections = new Map<RustGenericCallablePhysicalDefinition, RustGenericCallableErrorSelection>();
  for (const definition of definitions) {
    const prepared = preparations.forDefinition(definition);
    const node = definition.implementations[0]?.declaration;
    if (node === undefined) return rejectedTargetStage([{ code: "RUST_ERROR_REGION_UNRESOLVED", category: "error",
      source: "tsonic-rust", message: "A physical generic error domain requires its original implementation declaration." }]);
    if (prepared === undefined) return rejectedTargetStage([{ code: "RUST_ERROR_REGION_UNRESOLVED", category: "error",
      source: "tsonic-rust", sourceNode: node,
      message: "A physical generic error domain requires its exact selected invocation and awaiting channels." }]);
    const input = nativeTypeInputFor(definition.ownerFileName);
    const invocation = publishRustNativeErrorSources(prepared.invocation, node, input);
    const awaiting = publishRustNativeErrorSources(prepared.awaiting, node, input);
    if (invocation.kind === "rejected") return invocation;
    if (awaiting.kind === "rejected") return awaiting;
    const sources = new Map([...prepared.invocation.map((source, index) => [source, invocation.value[index]!] as const),
      ...prepared.awaiting.map((source, index) => [source, awaiting.value[index]!] as const)]);
    const members = new Map<RustGenericCallablePhysicalMember, RustGenericCallableMemberErrors>();
    for (const member of definition.members) {
      const selected = prepared.forMember(member);
      if (selected === undefined || selected.invocation !== undefined && !sources.has(selected.invocation) ||
        selected.awaiting !== undefined && !sources.has(selected.awaiting)) return rejectedTargetStage([{
        code: "RUST_ERROR_REGION_UNRESOLVED", category: "error", source: "tsonic-rust",
        sourceNode: member.implementation.declaration,
        message: "A physical generic member requires its original selected error-source identities." }]);
      members.set(member, Object.freeze({ effects: selected.effects,
        invocation: selected.invocation === undefined ? undefined : sources.get(selected.invocation),
        awaiting: selected.awaiting === undefined ? undefined : sources.get(selected.awaiting) }));
    }
    selections.set(definition, Object.freeze({ effects: prepared.effects, invocation: invocation.value, awaiting: awaiting.value,
      forMember: (member: RustGenericCallablePhysicalMember) => members.get(member) }));
  }
  return resolvedTargetStage(Object.freeze({ forDefinition: (definition: RustGenericCallablePhysicalDefinition) => selections.get(definition) }));
}
