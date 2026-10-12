import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageQueries } from "@tsonic/target-api/analysis";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import { substituteRustTargetGenericArgument } from "../../target-model/types/carriers/substitution.js";
import { rustTargetGenericBindingsForArguments } from "../../target-model/types/generic-arguments.js";
import { rustTargetGenericArgumentEquals, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustLifetimeKey, rustLifetimesEqual } from "../../target-model/lifetimes/index.js";
import { rustTargetOperationFactKey } from "../facts/keys.js";
import { rustRetainedCallSubstitutions } from "../facts/retained-environments.js";

export type RustNativeStorageGenericSelection =
  | { readonly kind: "resolved"; readonly bindings: RustTargetGenericBindings }
  | { readonly kind: "unresolved"; readonly reason: string };

export function createRustNativeStorageGenericSelection(input: {
  readonly ast: AstReader;
  readonly storage: SourceStorageQueries;
  readonly facts: RustPlanQueries;
  readonly step: (depth: number) => boolean;
}): (declaration: Node | undefined, bindings: SourceStorageBindings, depth: number) => RustNativeStorageGenericSelection {
  const empty: RustNativeStorageGenericSelection = Object.freeze({ kind: "resolved",
    bindings: Object.freeze({ types: new Map(), lifetimes: new Map(), consts: new Map() }) });
  const cache = new Map<Node, Map<SourceStorageBindings, RustNativeStorageGenericSelection | "resolving">>();
  const unresolved = (reason: string): RustNativeStorageGenericSelection => Object.freeze({ kind: "unresolved", reason });
  const select = (declaration: Node | undefined, bindings: SourceStorageBindings, depth: number): RustNativeStorageGenericSelection => {
    if (!input.step(depth)) return unresolved("Native callable activation exceeds its bounded projection budget.");
    if (declaration === undefined) return empty;
    const previous = cache.get(declaration)?.get(bindings);
    if (previous === "resolving") return unresolved("Native callable activation requires a completed generic substitution.");
    if (previous !== undefined) return previous;
    const values = cache.get(declaration) ?? new Map<SourceStorageBindings, RustNativeStorageGenericSelection | "resolving">();
    values.set(bindings, "resolving");
    cache.set(declaration, values);
    const finish = (selection: RustNativeStorageGenericSelection): RustNativeStorageGenericSelection => {
      values.set(bindings, selection);
      return selection;
    };
    const selected = input.storage.boundActivationsFor(declaration, bindings);
    if (selected.kind === "unresolved") return finish(selected);
    let result: RustTargetGenericBindings | undefined;
    for (const activation of selected.activations) {
      if (!input.step(depth)) return finish(unresolved("Native callable activation exceeds its bounded projection budget."));
      const lexical = select(sourceEnclosingCallable(input.ast.parent(declaration), input.ast), activation.bindings, depth + 1);
      if (lexical.kind === "unresolved") return finish(lexical);
      let actual = lexical.bindings;
      if (activation.kind === "invocation") {
        const signature = input.facts.getSelectedTargetCall(activation.invocation);
        const operation = input.facts.getFact(activation.invocation, rustTargetOperationFactKey);
        if (signature === undefined || operation?.kind !== "source-call")
          return finish(unresolved("Native callable activation has no exact finalized invocation signature."));
        const caller = select(sourceEnclosingCallable(activation.invocation, input.ast), activation.callerBindings, depth + 1);
        if (caller.kind === "unresolved") return finish(caller);
        const arguments_ = operation.targetGenericArguments ?? [];
        const own = rustTargetGenericBindingsForArguments(signature.member.genericParameters ?? [], arguments_.map(argument =>
          substituteRustTargetGenericArgument(argument, caller.bindings.types, caller.bindings.lifetimes, caller.bindings.consts)));
        const merged = own === undefined ? undefined : mergeBindings(actual, { ...own,
          lifetimes: new Map([...own.lifetimes, ...[...rustRetainedCallSubstitutions(input.facts, activation.invocation)]
            .map(([identity, lifetime]) => [identity, caller.bindings.lifetimes.get(rustLifetimeKey(lifetime)) ?? lifetime] as const)]) });
        if (merged === undefined)
          return finish(unresolved("Native callable activation has inconsistent selected generic arguments."));
        actual = merged;
      }
      if (result !== undefined && !sameBindings(result, actual))
        return finish(unresolved("Native callable activation has distinct generic substitutions requiring a sealed join."));
      result = actual;
    }
    return finish(result === undefined ? unresolved("Native callable activation has no selected generic environment.")
      : Object.freeze({ kind: "resolved", bindings: result }));
  };
  return select;
}

function mergeBindings(left: RustTargetGenericBindings, right: RustTargetGenericBindings): RustTargetGenericBindings | undefined {
  const types = mergeEntries(left.types, right.types, rustTargetTypeRefEquals);
  const lifetimes = mergeEntries(left.lifetimes, right.lifetimes, rustLifetimesEqual);
  const consts = mergeEntries(left.consts, right.consts, (left, right) =>
    rustTargetGenericArgumentEquals({ kind: "const", value: left }, { kind: "const", value: right }));
  return types === undefined || lifetimes === undefined || consts === undefined ? undefined : Object.freeze({ types, lifetimes, consts });
}

function mergeEntries<Value>(left: ReadonlyMap<string, Value>, right: ReadonlyMap<string, Value>,
  equal: (left: Value, right: Value) => boolean): ReadonlyMap<string, Value> | undefined {
  const values = new Map(left);
  for (const [identity, value] of right) {
    const previous = values.get(identity);
    if (previous !== undefined && !equal(previous, value)) return undefined;
    values.set(identity, value);
  }
  return values;
}

function sameBindings(left: RustTargetGenericBindings, right: RustTargetGenericBindings): boolean {
  return left.types.size === right.types.size && left.lifetimes.size === right.lifetimes.size &&
    left.consts.size === right.consts.size && mergeBindings(left, right) !== undefined;
}
