import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import { sourceDeclarationIsModuleScoped } from "@tsonic/target-api/source";
import type { RustLexicalFunctionEnvironments } from "./lexical-functions.js";
import type { RustClosureCaptureFact } from "../../target-model/records/operation-selections.js";

import { rustCapturedBindingStorage } from "./capture-storage.js";
import { appendRustDiagnostic } from "../program/walk.js";
import { rustRetainedCallableStorage } from "./results.js";

export function recordRustLexicalValueEnvironments(walk: RustFactWalk, lexical: RustLexicalFunctionEnvironments): void {
  const { ast, source, records } = walk.context;
  const visit = (node: Node): void => {
    if (ast.is.IsFunctionDeclaration(node) && ast.body(node) !== undefined && sourceDeclarationIsModuleScoped(node, ast)) {
      records.closureCaptures.capture(node, []);
    }
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
        records.bindingStoragePlans.capture(capture.declaration, carrier, storage);
        captures.push({ declaration: capture.declaration, reference: capture.reference, carrier, storage: storage.storage });
      }
      records.closureCaptures.capture(node, captures);
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  walk.context.sourceFiles.forEach(visit);
}
