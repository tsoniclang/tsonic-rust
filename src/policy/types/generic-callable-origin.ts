import type { AstReader, Node } from "@tsonic/tsts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import type { RustGenericCallableOrigin } from "../../target-model/types/carriers/generic-callables.js";

export function rustGenericCallableOrigin(ast: AstReader, declaration: Node | undefined): RustGenericCallableOrigin | undefined {
  if (declaration === undefined) return undefined;
  const identity = sourceNodeIdentity(ast, declaration);
  const sourceFile = ast.getSourceFile(declaration);
  if (identity === undefined || sourceFile === undefined) return undefined;
  const fileName = ast.getFileName(sourceFile);
  return fileName.length === 0 ? undefined : Object.freeze({ fileName, declarationIdentity: identity });
}
