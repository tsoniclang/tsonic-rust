import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { sourceBindingScope } from "@tsonic/target-api/source";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustBindingStorageFactKey } from "../facts/keys.js";

export interface RustDeferredCaptureStorage {
  forScope(scope: Node): readonly Node[];
}

export function analyzeRustDeferredCaptureStorage(input: {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly facts: RustPlanQueries;
}): RustDeferredCaptureStorage {
  const scopes = new Map<Node, Node[]>();
  const visit = (node: Node): void => {
    if (input.facts.getFact(node, rustBindingStorageFactKey)?.initialization === "deferred") {
      const scope = sourceBindingScope(node, input.ast);
      if (scope === undefined) throw new Error("Deferred capture storage requires an exact activation scope.");
      const declarations = scopes.get(scope) ?? [];
      declarations.push(node);
      scopes.set(scope, declarations);
    }
    input.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  input.sourceFiles.forEach(visit);
  const empty: readonly Node[] = Object.freeze([]);
  const selected = new Map([...scopes].map(([scope, declarations]) => [scope, Object.freeze(declarations)]));
  return Object.freeze({ forScope: (scope: Node) => selected.get(scope) ?? empty });
}
