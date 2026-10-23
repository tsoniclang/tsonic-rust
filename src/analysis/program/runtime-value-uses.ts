import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import { Node_Expression, Node_Initializer, sourceExpressionResultDisposition, sourceMayReadBeforeInitialization } from "@tsonic/target-api/source";
import type { RustSafetyApplicationFactIndex } from "../safety/application-index.js";
import { rustUnparenthesizedExpression } from "../../target-model/syntax/expressions.js";

export interface RustRuntimeValueUsePlan {
  isRuntimeReference(declaration: Node, reference: Node): boolean;
  /** A first-class runtime use other than the initializer of one of the declaration's Promise call aliases. */
  hasFirstClassUse(declaration: Node): boolean;
  firstClassReferencesFor(declaration: Node): readonly Node[];
  hasSameFileRuntimeUseBeforeDeclaration(declaration: Node): boolean;
  /**
   * A `const` binding initialized with a direct reference to a function declaration, never written and only ever called
   * directly, is a call alias: its calls are calls of that function.
   */
  callAliasTarget(binding: Node): Node | undefined;
  /**
   * A call alias of an async function whose every call is awaited in its own scope is a Promise call alias: each call
   * is a native Promise edge of the function, so the alias binding holds no runtime value.
   */
  promiseCallAliasTarget(binding: Node): Node | undefined;
}

export function createRustRuntimeValueUsePlan(input: {
  readonly ast: AstReader;
  readonly navigation: SourceProgramNavigation;
  readonly safetyApplications: RustSafetyApplicationFactIndex;
}): RustRuntimeValueUsePlan {
  const { ast, navigation } = input;
  const firstClassReferences = new WeakMap<Node, readonly Node[]>();
  const earlyRuntimeUseByDeclaration = new WeakMap<Node, boolean>();
  const isRuntimeReference = (declaration: Node, reference: Node): boolean =>
    !input.safetyApplications.isCompileTimeApplicationReference(declaration, reference);
  const outermost = (reference: Node): Node => {
    let current = reference;
    for (let parent = ast.parent(current); parent !== undefined && ast.is.IsParenthesizedExpression(parent); parent = ast.parent(parent))
      current = parent;
    return current;
  };
  const callAliasTarget = (binding: Node): Node | undefined => {
    if (!ast.is.IsVariableDeclaration(binding) || ast.variableDeclarationKind(binding) !== "const") return undefined;
    const initializer = Node_Initializer(ast, binding);
    if (initializer === undefined) return undefined;
    const target = navigation.sourceReferenceFor(rustUnparenthesizedExpression(ast, initializer))?.declaration;
    if (target === undefined || !ast.is.IsFunctionDeclaration(target) || ast.body(target) === undefined) return undefined;
    if (navigation.declarationUseSummary(binding).bindingWritten) return undefined;
    const uses = navigation.declarationUses(binding).filter(use => isRuntimeReference(binding, use.reference));
    return uses.length > 0 && uses.every(use => use.kind === "direct-call" && use.role === "call-target") ? target : undefined;
  };
  const promiseCallAliasTarget = (binding: Node): Node | undefined => {
    const target = callAliasTarget(binding);
    if (target === undefined || !ast.hasModifierKind(target, "async")) return undefined;
    return navigation.declarationUses(binding).every(use => {
      if (!isRuntimeReference(binding, use.reference)) return true;
      const callee = outermost(use.reference);
      const call = ast.parent(callee);
      if (call === undefined || !ast.is.IsCallExpression(call) || ast.as.AsCallExpression(call)?.QuestionDotToken !== undefined ||
        Node_Expression(ast, call) !== callee) return false;
      const result = sourceExpressionResultDisposition(ast, call);
      const awaited = result.kind === "awaited-in-scope" ? Node_Expression(ast, result.use) : undefined;
      return awaited !== undefined && rustUnparenthesizedExpression(ast, awaited) === call;
    }) ? target : undefined;
  };
  const firstClassReferencesFor = (declaration: Node): readonly Node[] => {
    const existing = firstClassReferences.get(declaration);
    if (existing !== undefined) return existing;
    const selected = Object.freeze(navigation.declarationUses(declaration).filter(use => {
      if (use.kind !== "first-class" || !isRuntimeReference(declaration, use.reference)) return false;
      const value = outermost(use.reference);
      const binding = ast.parent(value);
      return binding === undefined || Node_Initializer(ast, binding) !== value || promiseCallAliasTarget(binding) !== declaration;
    }).map(use => use.reference));
    firstClassReferences.set(declaration, selected);
    return selected;
  };
  return Object.freeze({
    isRuntimeReference,
    callAliasTarget,
    promiseCallAliasTarget,
    firstClassReferencesFor,
    hasFirstClassUse: (declaration: Node) => firstClassReferencesFor(declaration).length !== 0,
    hasSameFileRuntimeUseBeforeDeclaration(declaration: Node) {
      const existing = earlyRuntimeUseByDeclaration.get(declaration);
      if (existing !== undefined) {
        return existing;
      }
      const observed = sourceMayReadBeforeInitialization(declaration, input.ast, input.navigation);
      earlyRuntimeUseByDeclaration.set(declaration, observed);
      return observed;
    },
  });
}
