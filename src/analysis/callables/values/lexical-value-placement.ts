import type { Node } from "@tsonic/tsts";
import { isSourceCallableBodyBoundary, sourceBindingScope, type TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustRuntimeValueUsePlan } from "../../program/runtime-value-uses.js";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import { failTargetCompilerResourceLimit } from "@tsonic/target-api/artifacts";

type RustLexicalValuePlacement =
  | { readonly kind: "none" }
  | { readonly kind: "resolved"; readonly statement: Node; readonly inlineReference?: Node }
  | { readonly kind: "unresolved"; readonly reason: string };

export function selectRustLexicalValuePlacement(input: {
  readonly source: TargetSourceProgram;
  readonly declaration: Node;
  readonly nativeNodes: ReadonlySet<Node>;
  readonly runtimeUses: RustRuntimeValueUsePlan;
  readonly records: Pick<RustProgramRecords, "compileTimeSource">;
  readonly step: () => boolean;
  readonly maximumSteps: number;
}): RustLexicalValuePlacement {
  const { source, declaration, step } = input;
  const { ast, navigation } = source;
  const runtime = (owner: Node, reference: Node): boolean => input.nativeNodes.has(reference) &&
    input.records.compileTimeSource.get(reference) !== true && input.runtimeUses.isRuntimeReference(owner, reference);
  const references = input.runtimeUses.firstClassReferencesFor(declaration).filter(reference => runtime(declaration, reference));
  if (references.length === 0) return Object.freeze({ kind: "none" });
  const unresolved = (reason: string): RustLexicalValuePlacement => Object.freeze({ kind: "unresolved", reason });
  const scope = sourceBindingScope(declaration, ast);
  const statements = scope === undefined ? [] : ast.statements(scope);
  if (scope === undefined || statements.length === 0)
    return unresolved("A lexical Rust callable value requires its exact checked block activation.");
  const required = new Set<Node>();
  const expanded = new Set<Node>();
  const pending = [...references];
  let inline = references.length === 1;
  while (pending.length !== 0) {
    const reference = pending.pop()!;
    const ancestors = new Set<Node>();
    let current: Node | undefined = reference;
    while (current !== undefined && ast.parent(current) !== scope) {
      if (!step()) failTargetCompilerResourceLimit("tsonic-rust", "Native lexical value placement", "steps", input.maximumSteps, declaration);
      if (ancestors.has(current)) return unresolved("Rust lexical value placement requires acyclic checked ancestry.");
      ancestors.add(current);
      const parent = ast.parent(current);
      if (parent === undefined) return unresolved("A lexical Rust value escaped its checked block activation.");
      if (ast.is.IsForStatement(parent) || ast.is.IsForOfStatement(parent) || ast.is.IsForInStatement(parent) ||
        ast.is.IsWhileStatement(parent) || ast.is.IsDoStatement(parent)) inline = false;
      if (isSourceCallableBodyBoundary(ast, parent) && ast.body(parent) === current) {
        inline = false;
        if (ast.is.IsFunctionDeclaration(parent)) {
          if (!input.nativeNodes.has(parent)) return unresolved("A lexical Rust creation depends on an unmaterialized native caller.");
          if (!expanded.has(parent)) {
            expanded.add(parent);
            for (const use of navigation.declarationUseSummary(parent).uses) {
              if (!step()) failTargetCompilerResourceLimit("tsonic-rust", "Native lexical value placement", "steps", input.maximumSteps, declaration);
              if (use.kind !== "type-only" && use.kind !== "source-linkage" && runtime(parent, use.reference)) pending.push(use.reference);
            }
          }
          current = undefined;
          break;
        }
        if (!ast.is.IsArrowFunction(parent) && !ast.is.IsFunctionExpression(parent) &&
          !ast.is.IsObjectLiteralExpression(ast.parent(parent)))
          return unresolved("A lexical Rust value requires an admitted physical callable creation or direct caller.");
      }
      current = parent;
    }
    if (current !== undefined) {
      if (!statements.includes(current)) return unresolved("A lexical Rust creation has no identical checked block statement.");
      required.add(current);
    }
  }
  const statement = statements.find(candidate => required.has(candidate));
  if (statement === undefined)
    return unresolved("A retained lexical Rust callable has no completed native construction demand.");
  return Object.freeze({ kind: "resolved", statement, ...(inline ? { inlineReference: references[0]! } : {}) });
}
