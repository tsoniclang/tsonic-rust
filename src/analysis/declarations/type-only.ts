import type { Node, SourceFile } from "@tsonic/tsts";
import { sourceClassFieldIsTypeOnly, VariableDeclarationList_Declarations, VariableStatement_DeclarationList } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic } from "../program/walk.js";
import { rustTypeOnlyDeclarationFactKey } from "../facts/type-only.js";

export function recordRustTypeOnlyDeclarations(walk: RustFactWalk, sourceFiles: readonly SourceFile[]): void {
  const { ast, source, typeFamilies, facts } = walk.context;
  const families = new Set(typeFamilies.families().map(family => family.declaration));
  const belongsToFamily = (node: Node): boolean => {
    for (let current: Node | undefined = node; current !== undefined; current = ast.parent(current)) {
      if (families.has(current)) return true;
      if (ast.is.IsSourceFile(current)) return false;
    }
    return false;
  };
  const belongsToErasedMember = (node: Node): boolean => {
    for (let current: Node | undefined = node; current !== undefined; current = ast.parent(current)) {
      if (ast.kindName(current) === "KindPropertySignature" || sourceClassFieldIsTypeOnly(ast, current)) return true;
      if (ast.is.IsSourceFile(current)) return false;
    }
    return false;
  };
  for (const sourceFile of sourceFiles) {
    for (const statement of ast.statements(sourceFile)) {
      if (statement === undefined) throw new Error("Type-only declaration analysis received an incomplete checked source file.");
      if (ast.is.IsVariableStatement(statement) && ast.hasModifierKind(statement, "ambient")) {
        facts.set(statement, rustTypeOnlyDeclarationFactKey, { reason: "ambient" });
        const declarations = VariableDeclarationList_Declarations(ast, VariableStatement_DeclarationList(ast, statement));
        if (declarations === undefined || declarations.some(declaration => declaration === undefined)) {
          throw new Error("Ambient declaration analysis received an incomplete checked declaration list.");
        }
        for (const declaration of declarations as readonly Node[]) {
          for (const use of source.navigation.declarationUses(declaration)) {
            if (use.kind === "source-linkage" || use.kind === "type-only" || belongsToErasedMember(use.reference)) continue;
            appendRustDiagnostic(walk, "RUST_AMBIENT_VALUE_IMPLEMENTATION_MISSING",
              "A runtime read of an authored ambient variable requires an exact native implementation.", use.reference,
              ["target.capability=rust.ambient-value.implementation"]);
          }
          facts.set(declaration, rustTypeOnlyDeclarationFactKey, { reason: "ambient" });
        }
        continue;
      }
      if (!ast.is.IsInterfaceDeclaration(statement) || ast.extendsHeritageElements(statement).length !== 0) continue;
      const members = ast.members(statement);
      if (members.length === 0 || members.some(member => member === undefined ||
        ast.kindName(member) !== "KindPropertySignature" ||
        ast.kindName(ast.name(member)) !== "KindComputedPropertyName")) continue;
      const uses = source.navigation.declarationUses(statement);
      if (!uses.some(use => belongsToFamily(use.reference)) ||
        uses.some(use => use.kind !== "source-linkage" && !belongsToFamily(use.reference))) continue;
      facts.set(statement, rustTypeOnlyDeclarationFactKey, { reason: "type-family-predicate" });
    }
  }
}
