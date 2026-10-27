import type { RustTargetGenericArgument, TargetTypeRef } from "../../../target-model/types/model.js";
import { rustNativeCallableCompletion } from "../../../policy/types/callables/native-completion.js";
import { rustJsPromiseTargetId, rustSourceUnionTargetType } from "../../../target-model/types/carriers/source-types.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../../../target-model/metadata/closed-data.js";
import { normalizeRustErrorType, type RustErrorTypeContext } from "../../errors/error-types.js";
import type { RustTypeDefinitionRegistry } from "../../project-types/type-definitions.js";
import { rustGenericCallableInvocationBindings, type RustGenericCallableBindingContext } from "./generic-bindings.js";
import type { RustGenericCallablePhysicalDefinition, RustGenericCallablePhysicalMember } from "../../../target-model/records/callables/generic-callables.js";

export interface RustGenericCallableCompletionPlan {
  forDefinition(definition: RustGenericCallablePhysicalDefinition): RustGenericCallableCompletionSelection;
  invocationResultFor(carrier: TargetTypeRef, arguments_: readonly RustTargetGenericArgument[]): TargetTypeRef | undefined;
}

export type RustGenericCallableCompletionInput = RustGenericCallableBindingContext & RustErrorTypeContext & {
  readonly definitions: RustTypeDefinitionRegistry;
};

export function createRustGenericCallableCompletionPlan(
  input: RustGenericCallableCompletionInput,
): RustGenericCallableCompletionPlan {
  const selections = new Map<RustGenericCallablePhysicalDefinition, RustGenericCallableCompletionSelection>();
  const unresolved = (reason: string): RustGenericCallableCompletionSelection => Object.freeze({ kind: "unresolved", reason });
  const select = (definition: RustGenericCallablePhysicalDefinition): RustGenericCallableCompletionSelection => {
    const completion = rustNativeCallableCompletion(definition.signature.result, input.definitions);
    if (completion === undefined || completion.futures.every(future =>
      future.carrier.kind !== "target-named" || future.carrier.id !== rustJsPromiseTargetId))
      return Object.freeze({ kind: "direct", result: definition.signature.result });
    if (completion.futures.some(future => future.carrier.kind !== "target-named" || future.carrier.id !== rustJsPromiseTargetId))
      return unresolved("A generic callable completion requires an exact common native completion representation.");
    const results: TargetTypeRef[] = [];
    const resultIndexes = new Map<string, number>();
    const members = new Map<RustGenericCallablePhysicalMember, { result: TargetTypeRef; index: number }>();
    for (const member of definition.members) {
      const declaration = member.implementation.declaration;
      const bindings = member.bindings;
      const produced = input.producers.invocationResultFor(declaration);
      if (bindings === undefined || produced === undefined)
        return unresolved("A generic callable member has no exact physical invocation result or environment binding.");
      const bound = substituteRustTargetGenerics(produced, bindings.types, bindings.lifetimes, bindings.consts);
      const result = normalizeRustErrorType(bound, input, declaration);
      if (result === undefined)
        return unresolved("A generic callable completion has no exact producer-owned physical error channel.");
      const key = closedMetadataKey(result);
      let index = resultIndexes.get(key);
      if (index === undefined) {
        index = results.length;
        results.push(result);
        resultIndexes.set(key, index);
      }
      members.set(member, { result, index });
    }
    if (results.length === 0) return unresolved("A generic callable completion has no selected physical members.");
    const result = results.length === 1 ? results[0]! : rustSourceUnionTargetType(definition.ownerFileName,
      `Union${results.length}`, [], "generated", { kind: "physical", types: results });
    if (results.length > 1 && !input.definitions.registerSourceUnion({ carrier: result,
      variants: results.map((carrier, index) => ({ name: `Variant${index}`, carrier })) }, false))
      return unresolved("A generic callable completion conflicts with its canonical physical union definition.");
    const selected = new Map([...members].map(([member, value]) => [member, Object.freeze({ result: value.result,
      variant: results.length === 1 ? undefined : `Variant${value.index}` })]));
    return sealRustGenericCallableCompletionSelection({ kind: "selected", result: snapshotClosedMetadata(result), members: selected });
  };
  for (const definition of input.physical.definitions()) selections.set(definition, select(definition));
  const forDefinition = (definition: RustGenericCallablePhysicalDefinition): RustGenericCallableCompletionSelection =>
    selections.get(definition) ?? unresolved("A generic completion requires its exact finalized physical family definition.");
  return Object.freeze({ forDefinition,
    invocationResultFor(carrier: TargetTypeRef, arguments_: readonly RustTargetGenericArgument[]): TargetTypeRef | undefined {
      const definition = input.physical.definitionFor(carrier);
      const bindings = definition === undefined ? undefined : rustGenericCallableInvocationBindings(
        definition, carrier, arguments_, input.physical);
      const selection = definition === undefined ? undefined : forDefinition(definition);
      if (bindings === undefined || selection === undefined || selection.kind === "unresolved") return undefined;
      const result = substituteRustTargetGenerics(selection.result, bindings.types, bindings.lifetimes, bindings.consts);
      return rustTargetTypeRefEquals(result, selection.result) ? selection.result : snapshotClosedMetadata(result);
    },
  });
}

import type { RustGenericCallableCompletionSelection } from "../../../target-model/records/callables/generic-callable-completions.js";
import { sealRustGenericCallableCompletionSelection } from "../../program/records/callables/generic-callable-completions.js";
