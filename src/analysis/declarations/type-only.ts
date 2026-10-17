import type { Node, SourceFile } from "@tsonic/tsts";
import { sourceClassFieldIsTypeOnly, VariableDeclarationList_Declarations, VariableStatement_DeclarationList } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic } from "../program/walk.js";

export function recordRustTypeOnlyDeclarations(walk: RustFactWalk, sourceFiles: readonly SourceFile[]): void {
  walk.context.records.typeOnlyDeclarations.finalize(walk, sourceFiles);
}

export function selectRustTypeOnlyDeclaration(
  walk: RustFactWalk, statement: Node, families: ReadonlySet<Node>,
): "ambient" | "type-family-predicate" | undefined {
  const { ast, source } = walk.context;
  if (ast.is.IsVariableStatement(statement) && ast.hasModifierKind(statement, "ambient")) return "ambient";
  if (!ast.is.IsInterfaceDeclaration(statement) || ast.extendsHeritageElements(statement).length !== 0) return undefined;
  const members = ast.members(statement);
  if (members.length === 0 || members.some(member => member === undefined ||
    ast.kindName(member) !== "KindPropertySignature" ||
    ast.kindName(ast.name(member)) !== "KindComputedPropertyName")) return undefined;
  const belongsToFamily = (node: Node): boolean => {
    for (let current: Node | undefined = node; current !== undefined; current = ast.parent(current)) {
      if (families.has(current)) return true;
      if (ast.is.IsSourceFile(current)) return false;
    }
    return false;
  };
  const uses = source.navigation.declarationUses(statement);
  return uses.some(use => belongsToFamily(use.reference)) &&
    !uses.some(use => use.kind !== "source-linkage" && !belongsToFamily(use.reference))
    ? "type-family-predicate" : undefined;
}

export function rustAmbientVariableDeclarations(walk: RustFactWalk, statement: Node): readonly Node[] {
  const { ast } = walk.context;
  const declarations = VariableDeclarationList_Declarations(ast, VariableStatement_DeclarationList(ast, statement));
  if (declarations === undefined || declarations.some(declaration => declaration === undefined)) {
    throw new Error("Ambient declaration analysis received an incomplete checked declaration list.");
  }
  return declarations as readonly Node[];
}

export function checkRustAmbientVariableUses(walk: RustFactWalk, declaration: Node): void {
  const { ast, source } = walk.context;
  const belongsToErasedMember = (node: Node): boolean => {
    for (let current: Node | undefined = node; current !== undefined; current = ast.parent(current)) {
      if (ast.kindName(current) === "KindPropertySignature" || sourceClassFieldIsTypeOnly(ast, current)) return true;
      if (ast.is.IsSourceFile(current)) return false;
    }
    return false;
  };
  for (const use of source.navigation.declarationUses(declaration)) {
    if (!walk.context.isNativeNode(use.reference)) continue;
    if (use.kind === "source-linkage" || use.kind === "type-only" || belongsToErasedMember(use.reference)) continue;
    appendRustDiagnostic(walk, "RUST_AMBIENT_VALUE_IMPLEMENTATION_MISSING",
      "A runtime read of an authored ambient variable requires an exact native implementation.", use.reference,
      ["target.capability=rust.ambient-value.implementation"]);
  }
}
