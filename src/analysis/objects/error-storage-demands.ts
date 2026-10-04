import type { Node, SourceFile } from "@tsonic/tsts";
import { VariableDeclarationList_Declarations, VariableStatement_DeclarationList, type TargetSourceProgram } from "@tsonic/target-api/source";
import { createSourceErrorStorageDemandQuery, type SourceErrorRetainedDemand, type SourceErrorStorageDemandQueries } from "@tsonic/target-api/analysis";
import { resolveRustSourceErrorDeclaration } from "../../policy/types/external-project-types.js";
import type { RustSourceProfileRegistry } from "../../policy/types/source-profile.js";
import { rustSourceErrorConstructors } from "../../target-model/identities/source-errors.js";

export function createRustErrorStorageDemandQuery(
  source: TargetSourceProgram,
  profiles: RustSourceProfileRegistry,
  sourceFiles: readonly SourceFile[],
  retention: (node: Node) => SourceErrorRetainedDemand,
): SourceErrorStorageDemandQueries {
  const { ast } = source;
  const fields = new Set<Node>();
  const constructors = new Set<Node>();
  const stackCaptures = new Set<Node>();
  for (const file of source.sourceFiles) {
    for (const statement of ast.statements(file)) {
      if (statement === undefined || profiles.profileForNode(statement, ast) === undefined) continue;
      if (ast.is.IsInterfaceDeclaration(statement) && rustSourceErrorConstructors.some(constructor =>
        constructor.ownerName === ast.text(ast.name(statement)))) {
        for (const member of ast.members(statement)) {
          if (member === undefined) continue;
          if (ast.is.IsConstructSignatureDeclaration(member) || ast.is.IsCallSignatureDeclaration(member)) constructors.add(member);
          if (ast.text(ast.name(statement)) === "ErrorConstructor" && ast.text(ast.name(member)) === "captureStackTrace") stackCaptures.add(member);
        }
      }
      for (const declaration of VariableDeclarationList_Declarations(ast, VariableStatement_DeclarationList(ast, statement)) ?? []) {
        if (declaration === undefined) continue;
        const root = resolveRustSourceErrorDeclaration(declaration, ast, profiles);
        if (root === undefined) continue;
        for (const field of root.fields) fields.add(field.declaration);
        for (const constructor of root.constructorDeclarations) constructors.add(constructor);
      }
    }
  }
  return createSourceErrorStorageDemandQuery(source, { fields: [...fields], constructors: [...constructors],
    stackCaptures: [...stackCaptures], storageMutators: [], retention }, sourceFiles);
}
