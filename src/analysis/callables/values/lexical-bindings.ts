import type { Node } from "@tsonic/tsts";
import type { RustExplicitUnsafeContexts } from "../../safety/explicit-regions.js";
import { Node_Expression, Node_Initializer, sourceDeclarationIsModuleScoped, sourceLexicalCaptures, sourceMayReadBeforeInitialization, type TargetSourceProgram } from "@tsonic/target-api/source";

import type { RustSourceLexicalCallableQueries } from "../../../target-model/records/source-callables.js";

export function createRustSourceLexicalCallableQueries(source: TargetSourceProgram, nodes: readonly Node[],
  explicitUnsafe: RustExplicitUnsafeContexts): RustSourceLexicalCallableQueries {
  const bindings = new WeakMap<Node, Node | null>();
  const calls = new WeakMap<Node, WeakMap<Node, readonly Node[] | null>>();
  const callsFor = (binding: Node, implementation: Node): readonly Node[] | undefined => {
    const implementations = calls.get(binding) ?? new WeakMap<Node, readonly Node[] | null>();
    const cached = implementations.get(implementation);
    if (cached !== undefined) return cached ?? undefined;
    const selected = selectSourceDirectCalls(binding, implementation, source);
    implementations.set(implementation, selected ?? null);
    calls.set(binding, implementations);
    return selected;
  };
  for (const declaration of nodes) {
    if (source.ast.is.IsFunctionDeclaration(declaration)) callsFor(declaration, declaration);
    else if (source.ast.is.IsArrowFunction(declaration)) {
      // A lexical function is emitted as a separate Rust item, which does not inherit an enclosing unsafe block; an
      // arrow inside an explicit unsafecontext() region stays a closure so that it keeps the region's unsafety.
      const selected = explicitUnsafe.has(declaration) ? undefined : selectDirectLexicalCallableBinding(declaration, source, callsFor);
      bindings.set(declaration, selected ?? null);
    }
  }
  return Object.freeze({
    callsFor: (binding: Node, implementation: Node) => calls.get(binding)?.get(implementation) ?? undefined,
    bindingFor: (declaration: Node) => bindings.get(declaration) ?? undefined,
  });
}

function selectDirectLexicalCallableBinding(
  declaration: Node,
  source: TargetSourceProgram,
  callsFor: RustSourceLexicalCallableQueries["callsFor"],
): Node | undefined {
  const { ast, navigation } = source;
  if (!ast.is.IsArrowFunction(declaration) || ast.hasModifierKind(declaration, "async")) return undefined;
  const binding = ast.parent(declaration);
  if (binding === undefined || !ast.is.IsVariableDeclaration(binding) ||
    ast.variableDeclarationKind(binding) !== "const" || Node_Initializer(ast, binding) !== declaration ||
    sourceDeclarationIsModuleScoped(binding, ast) || ast.name(binding) === undefined ||
    !ast.is.IsIdentifier(ast.name(binding)!)) return undefined;
  if (navigation.declarationUseSummary(binding).captured ||
    sourceMayReadBeforeInitialization(binding, ast, navigation) ||
    callsFor(binding, declaration) === undefined) return undefined;
  const captures = sourceLexicalCaptures(declaration, [declaration], ast, navigation, "source");
  return captures.receivers.length === 0 ? binding : undefined;
}

function selectSourceDirectCalls(
  binding: Node,
  implementation: Node,
  source: TargetSourceProgram,
): readonly Node[] | undefined {
  const { ast, navigation } = source;
  const summary = navigation.declarationUseSummary(binding);
  if (summary.bindingWritten || summary.memberWritten || summary.exported || summary.aliasedOrStored ||
    summary.hasUnclassifiedValueUse || summary.directCallCount === 0 || summary.uses.length > 131_072) return undefined;
  const calls: Node[] = [];
  for (const use of summary.uses) {
    if (use.kind === "type-only") continue;
    if (use.kind !== "direct-call" || use.role !== "call-target" || use.throughMember) return undefined;
    let callee = use.reference;
    let call = ast.parent(callee);
    while (call !== undefined && ast.is.IsParenthesizedExpression(call) && Node_Expression(ast, call) === callee) {
      callee = call;
      call = ast.parent(callee);
    }
    if (call === undefined || !ast.is.IsCallExpression(call) || Node_Expression(ast, call) !== callee) return undefined;
    const semantics = source.semantics.forNode(call);
    const selected = semantics.operations.call(call);
    if (selected === undefined || semantics.declarations.signatureDeclaration(selected.selectedSignature) !== implementation)
      return undefined;
    calls.push(call);
  }
  return Object.freeze(calls);
}
