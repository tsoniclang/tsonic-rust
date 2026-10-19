import { Node_Type } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import type { RustAsyncFunctionFact, RustGeneratorFact } from "../../target-model/records/callables-and-resources.js";
import type { RustRetainedEnvironment } from "../../target-model/records/retained-environments.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { getRustGeneratorProtocol } from "../../target-model/types/index.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution/index.js";
import { rustGeneratorFact } from "../program/records/generator.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import type { RustFactWalk } from "../program/walk.js";
import { selectedSourceCallableReturn } from "./signatures.js";
import { resolveRustSuspendedCallableStorage } from "./suspension-storage.js";
import { selectRustAsyncBodyFacts } from "./async-results.js";

export type RustCallableSuspensionSelection =
  | { readonly kind: "none" }
  | { readonly kind: "async"; readonly fact: RustAsyncFunctionFact; readonly retainedEnvironment?: RustRetainedEnvironment }
  | { readonly kind: "generator"; readonly fact: RustGeneratorFact; readonly sourceCarrier: TargetTypeRef;
      readonly retainedEnvironment?: RustRetainedEnvironment };

export function selectRustCallableSuspension(
  walk: RustFactWalk, declaration: Node, ownedReceiver?: TargetTypeRef, contextualResult?: TargetTypeRef,
): RustCallableSuspensionSelection | undefined {
  walk.context.records.assertOpen();
  const { ast } = walk.context;
  const sourceReturn = selectedSourceCallableReturn(walk, declaration);
  const sourceGenerator = walk.context.semanticsFor(declaration).operations.generator(declaration);
  if (sourceGenerator !== undefined) {
    const carrier = resolveRustTargetTypeRef(Node_Type(ast, declaration) ?? sourceGenerator.sourceReturnType ?? sourceReturn,
      rustResolutionContext(walk, declaration), walk.operationOptions);
    const protocol = getRustGeneratorProtocol(carrier);
    if (carrier === undefined || protocol?.kind !== sourceGenerator.generatorKind) {
      appendRustDiagnostic(walk, "RUST_GENERATOR_PROTOCOL_NOT_CLOSED",
        "The checked generator declaration has no closed Rust yield, return, and next protocol.", declaration,
        ["target.capability=rust.generator.protocol"]);
      return undefined;
    }
    const storage = resolveRustSuspendedCallableStorage(walk, declaration,
      [protocol.yieldType, protocol.returnType, protocol.nextType], ownedReceiver);
    if (storage.kind === "rejected") {
      appendRustDiagnostic(walk, "RUST_GENERATOR_STORAGE_LIFETIME_NOT_PROVEN", storage.reason, declaration,
        ["target.capability=rust.generator.storage-lifetime"]);
      return undefined;
    }
    return { kind: "generator", fact: rustGeneratorFact(protocol, storage), sourceCarrier: carrier,
      ...(storage.retainedEnvironment === undefined ? {} : { retainedEnvironment: storage.retainedEnvironment }),
    };
  }
  if (!ast.hasModifierKind(declaration, "async")) return { kind: "none" };
  const future = resolveRustTargetTypeRef(Node_Type(ast, declaration) ?? sourceReturn,
    rustResolutionContext(walk, declaration), walk.operationOptions);
  const selected = selectRustAsyncBodyFacts(walk, declaration, future, ownedReceiver, contextualResult);
  return selected === undefined ? undefined : { kind: "async", ...selected };
}
