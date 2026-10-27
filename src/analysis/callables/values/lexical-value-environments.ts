import { requireRustRecord } from "../../program/records/objects/required-records.js";
import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../../program/walk.js";
import { sourceDeclarationIsModuleScoped } from "@tsonic/target-api/source";
import type { RustLexicalFunctionEnvironments } from "../../../target-model/records/callables/lexical-functions.js";
import type { RustClosureCaptureFact } from "../../../target-model/records/operations/operation-selections.js";

import { rustCapturedBindingStorage } from "../storage/capture-storage.js";
import { appendRustDiagnostic } from "../../program/walk.js";
import { rustRetainedCallableStorage } from "../../../policy/types/callables/return-contexts.js";

export function recordRustLexicalValueEnvironments(walk: RustFactWalk, lexical: RustLexicalFunctionEnvironments): void {
  const { ast, source, records } = walk.context;
  const visit = (node: Node): void => {
    if (!walk.context.isNativeNode(node)) return;
    const selection = lexical.forDeclaration(node);
    const retained = rustRetainedCallableStorage(records, node) !== undefined;
    if (selection?.kind === "resolved" && (selection.valueObserved || retained)) {
      const captures: RustClosureCaptureFact["captures"][number][] = [];
      const exclusivelyObserved = source.navigation.declarationUseSummary(node).uses.every(use => {
        if (use.kind !== "direct-call") return true;
        for (let current = ast.parent(use.reference); current !== undefined; current = ast.parent(current)) {
          if (current === node) return true;
        }
        return false;
      });
      for (const capture of selection.captures) {
        const carrier = records.runtimeCarrier.get(capture.declaration)?.carrier ?? records.runtimeCarrier.get(capture.reference)?.carrier;
        const storage = rustCapturedBindingStorage(walk, capture.declaration, capture.reference, node, carrier,
          exclusivelyObserved && !retained, undefined, selection.captureRoots);
        if (carrier === undefined || storage === undefined) {
          appendRustDiagnostic(walk, "RUST_LEXICAL_CAPTURE_NOT_CLOSED", "A lexical value requires its exact retained native capture contract.",
            capture.reference, ["target.capability=rust.lexical-function.environment"]);
          continue;
        }
        captures.push({ declaration: capture.declaration, reference: capture.reference, carrier, storage: storage.storage });
      }
      requireRustRecord(walk.context.requiredRecords, "closureCapture", node, "lexical-environment", "recordRustLexicalValueEnvironments");
      records.closureCaptures.capture(node, captures);
    } else if (ast.is.IsFunctionDeclaration(node) && ast.body(node) !== undefined && sourceDeclarationIsModuleScoped(node, ast)) {
      requireRustRecord(walk.context.requiredRecords, "closureCapture", node, "module-environment", "recordRustLexicalValueEnvironments");
      records.closureCaptures.capture(node, []);
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  walk.context.sourceFiles.forEach(visit);
}
