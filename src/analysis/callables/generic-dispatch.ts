import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

import type { RustTargetOperationFact } from "../../target-model/records/operations.js";
import type { RustGenericCallablePhysicalDefinition } from "./generic-physical.js";
import type { RustGenericCallablePlan } from "./generic-values.js";
import type { RustNativeStoragePlan } from "./native-storage.js";
import type { RustNativeGenericProducerPlan } from "./native-generic-producers.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";
import { rustSourceCallCallableStorageCarrier } from "../operations/target-operation.js";
import type { RustStructuralStorageLookup } from "../operations/target-operation.js";

interface RustGenericCallableInvocationInput {
  readonly ast: AstReader;
  readonly records: RustProgramRecords;
  readonly generic: RustGenericCallablePlan;
  readonly nativeStorage: Pick<RustNativeStoragePlan, "invocationCallableFor">;
  readonly structuralShapes: RustStructuralStorageLookup;
}

export interface RustGenericCallableDispatchPlan {
  requiredFor(definition: RustGenericCallablePhysicalDefinition): boolean;
  usesDeclarationBody(declaration: Node): boolean;
}

export function selectRustGenericCallableInvocationStorage(
  node: Node, input: RustGenericCallableInvocationInput,
): { readonly operation: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>;
  readonly carrier: TargetTypeRef; readonly definition: RustGenericCallablePhysicalDefinition } | undefined {
  const operation = input.records.targetOperation.get(node);
  if (operation?.kind !== "source-call") return undefined;
  const callee = Node_Expression(input.ast, node);
  const logical = operation.target.form === "structural-method"
    ? rustSourceCallCallableStorageCarrier(operation, input.structuralShapes)
    : rustEffectiveValueCarrier(input.records, callee);
  if (callee === undefined || logical === undefined || input.generic.definitionFor(logical) === undefined) return undefined;
  const storage = input.nativeStorage.invocationCallableFor(node);
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
  const requiredFor = (definition: RustGenericCallablePhysicalDefinition): boolean =>
    !closed.has(definition.ownerFileName) || invoked.has(definition);
  const bodies = new Set<Node>();
  for (const definition of input.generic.physical.definitions()) {
    if (!requiredFor(definition)) continue;
    for (const member of definition.members) bodies.add(member.implementation.declaration);
  }
  return Object.freeze({ requiredFor, usesDeclarationBody: (declaration: Node) => bodies.has(declaration) });
}
