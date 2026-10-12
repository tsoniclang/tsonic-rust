import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetOperationFactKey, type RustTargetOperationFact } from "../facts/keys.js";
import { rustEffectiveValueCarrier } from "../facts/value-carrier-queries.js";
import type { RustGenericCallablePhysicalDefinition } from "./generic-physical.js";
import type { RustGenericCallablePlan } from "./generic-values.js";
import type { RustNativeStoragePlan } from "./native-storage.js";
import type { RustNativeGenericProducerPlan } from "./native-generic-producers.js";

interface RustGenericCallableInvocationInput {
  readonly ast: AstReader;
  readonly facts: RustPlanQueries;
  readonly generic: RustGenericCallablePlan;
  readonly nativeStorage: RustNativeStoragePlan;
}

export interface RustGenericCallableDispatchPlan {
  requiredFor(definition: RustGenericCallablePhysicalDefinition): boolean;
}

export function selectRustGenericCallableInvocationStorage(
  node: Node, input: RustGenericCallableInvocationInput,
): { readonly operation: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>;
  readonly carrier: TargetTypeRef; readonly definition: RustGenericCallablePhysicalDefinition } | undefined {
  const operation = input.facts.getFact(node, rustTargetOperationFactKey);
  if (operation?.kind !== "source-call") return undefined;
  const callee = Node_Expression(input.ast, node);
  const logical = rustEffectiveValueCarrier(input.facts, callee);
  if (callee === undefined || logical === undefined || input.generic.definitionFor(logical) === undefined) return undefined;
  const storage = input.nativeStorage.valueFor(callee);
  if (storage === undefined || storage.kind === "unresolved") return undefined;
  const definition = input.generic.physical.definitionFor(storage.carrier);
  return definition === undefined ? undefined : { operation, carrier: storage.carrier, definition };
}

export function createRustGenericCallableDispatchPlan(input: RustGenericCallableInvocationInput & {
  readonly nodes: readonly Node[];
  readonly closedSourceFiles: ReadonlySet<SourceFile>;
  readonly nativeGenericProducers: RustNativeGenericProducerPlan;
}): RustGenericCallableDispatchPlan {
  const closed = new Set([...input.closedSourceFiles].map(file => input.ast.getFileName(file)));
  const invoked = new Set(input.nativeGenericProducers.bindings.map(binding => binding.definition));
  for (const node of input.nodes) {
    const selected = selectRustGenericCallableInvocationStorage(node, input);
    if (selected !== undefined) invoked.add(selected.definition);
  }
  return Object.freeze({ requiredFor: (definition: RustGenericCallablePhysicalDefinition) =>
    !closed.has(definition.ownerFileName) || invoked.has(definition) });
}
