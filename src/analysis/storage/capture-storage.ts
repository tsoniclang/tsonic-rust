import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { sourceBindingScope } from "@tsonic/target-api/source";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustBindingStorageFactKey } from "../facts/keys.js";

export interface RustCaptureStoragePlan {
  deferredForScope(scope: Node): readonly Node[];
  iterationsForScope(scope: Node): readonly Node[];
}

export function analyzeRustCaptureStorage(input: {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly facts: RustPlanQueries;
}): RustCaptureStoragePlan {
  const scopes = new Map<Node, Node[]>();
  const iterations = new Map<Node, Node[]>();
  const visit = (node: Node): void => {
    const fact = input.facts.getFact(node, rustBindingStorageFactKey);
    if (fact?.initialization === "deferred") {
      const scope = sourceBindingScope(node, input.ast);
      if (scope === undefined) throw new Error("Deferred capture storage requires an exact activation scope.");
      const declarations = scopes.get(scope) ?? [];
      declarations.push(node);
      scopes.set(scope, declarations);
    }
    if (fact?.iterationScope !== undefined) {
      if (fact.storage !== "location" || input.ast.variableDeclarationKind(node) !== "let" ||
        input.ast.kindName(fact.iterationScope) !== "KindForStatement" ||
        sourceBindingScope(node, input.ast) !== fact.iterationScope) {
        throw new Error("Iteration capture storage requires its exact lexical activation scope.");
      }
      const declarations = iterations.get(fact.iterationScope) ?? [];
      declarations.push(node);
      iterations.set(fact.iterationScope, declarations);
    }
    input.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  input.sourceFiles.forEach(visit);
  const empty: readonly Node[] = Object.freeze([]);
  const selected = new Map([...scopes].map(([scope, declarations]) => [scope, Object.freeze(declarations)]));
  const selectedIterations = new Map([...iterations].map(([scope, declarations]) => [scope, Object.freeze(declarations)]));
  return Object.freeze({
    deferredForScope: (scope: Node) => selected.get(scope) ?? empty,
    iterationsForScope: (scope: Node) => selectedIterations.get(scope) ?? empty,
  });
}
