import type { Node, SourceFile } from "@tsonic/tsts";
import {
  KindVariableDeclaration,
  KindVariableStatement,
  Node_Type,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import { rustModuleBindingFactKey } from "../facts/keys.js";
import { rustCompileTimeSourceKey } from "../../target-model/facts/source-declarations.js";
import { resolveTypeNodeCarrier } from "../control-flow/statements.js";
import { setCarrierFact } from "../operations/project-calls.js";
import type { RustFactWalk } from "./walk.js";

export function recordRustModuleValueDeclarations(walk: RustFactWalk, sourceFile: SourceFile): void {
  const { ast, facts } = walk.context;
  for (const statement of ast.statements(sourceFile)) {
    if (statement === undefined || ast.kindName(statement) !== KindVariableStatement) continue;
    const declarations = VariableDeclarationList_Declarations(ast, VariableStatement_DeclarationList(ast, statement));
    if (declarations === undefined) continue;
    for (const declaration of declarations) {
      if (declaration === undefined || ast.kindName(declaration) !== KindVariableDeclaration ||
        facts.get(declaration, rustCompileTimeSourceKey) ||
        facts.get(declaration, rustModuleBindingFactKey)?.storage === "native-callable") continue;
      recordDeclaration(walk, declaration);
    }
  }
}

function recordDeclaration(walk: RustFactWalk, declaration: Node): void {
  const { ast, facts } = walk.context;
  const declarationKind = ast.variableDeclarationKind(declaration);
  if (declarationKind !== "const" && declarationKind !== "let" && declarationKind !== "var") return;
  const carrier = resolveTypeNodeCarrier(walk, Node_Type(ast, declaration));
  if (carrier === undefined || setCarrierFact(walk, declaration, carrier) === undefined) return;
  facts.set(declaration, rustModuleBindingFactKey,
    walk.moduleBindings.classifyValue(declaration, declarationKind, carrier),
    [{ message: "rust finalized annotated module storage before dependent bodies" }]);
}
