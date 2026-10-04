import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { RustLexicalFunctionQueries } from "./lexical-functions.js";
import type { RustClosureCaptureFact } from "../facts/operations/keys.js";
import { rustBindingStorageFactKey, rustClosureCaptureFactKey } from "../facts/keys.js";
import { rustCapturedBindingStorage } from "./capture-storage.js";
import { appendRustDiagnostic } from "../program/walk.js";

export function recordRustLexicalValueEnvironments(walk: RustFactWalk, lexical: RustLexicalFunctionQueries): void {
  const { ast, source, facts } = walk.context;
  const visit = (node: Node): void => {
    const selection = lexical.forDeclaration(node);
    if (selection?.kind === "resolved" && selection.valueObserved) {
      const captures: RustClosureCaptureFact["captures"][number][] = [];
      const exclusivelyObserved = source.navigation.declarationUseSummary(node).uses.every(use => {
        if (use.kind !== "direct-call") return true;
        for (let current = ast.parent(use.reference); current !== undefined; current = ast.parent(current)) {
          if (current === node) return true;
        }
        return false;
      });
      for (const capture of selection.captures) {
        const carrier = facts.getRuntimeCarrierFact(capture.declaration)?.carrier ?? facts.getRuntimeCarrierFact(capture.reference)?.carrier;
        const storage = rustCapturedBindingStorage(walk, capture.declaration, capture.reference, node, carrier,
          exclusivelyObserved, undefined, selection.captureRoots);
        if (carrier === undefined || storage === undefined) {
          appendRustDiagnostic(walk, "RUST_LEXICAL_CAPTURE_NOT_CLOSED", "A lexical value requires its exact retained native capture contract.",
            capture.reference, ["target.capability=rust.lexical-function.environment"]);
          continue;
        }
        if (storage.storage !== "value") facts.set(capture.declaration, rustBindingStorageFactKey, {
          storage: storage.storage, valueCarrier: carrier,
          ...(storage.initialization === undefined ? {} : { initialization: storage.initialization }),
        });
        captures.push({ declaration: capture.declaration, reference: capture.reference, carrier, storage: storage.storage });
      }
      facts.set(node, rustClosureCaptureFactKey, { captures });
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  walk.context.sourceFiles.forEach(visit);
}
