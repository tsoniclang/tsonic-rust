import type { AstReader, Node } from "@tsonic/tsts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import type { RustCallableOrigin } from "../../target-model/types/carriers/callable-signatures.js";
import { rustGenericCallableCarrier, rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export function rustCallableOrigin(ast: AstReader, declaration: Node | undefined): RustCallableOrigin | undefined {
  if (declaration === undefined) return undefined;
  const identity = sourceNodeIdentity(ast, declaration);
  const sourceFile = ast.getSourceFile(declaration);
  if (identity === undefined || sourceFile === undefined) return undefined;
  const fileName = ast.getFileName(sourceFile);
  return fileName.length === 0 ? undefined : Object.freeze({ fileName, declarationIdentity: identity });
}

export function rustGenericCallableValueOwner(
  ast: AstReader, declaration: Node, carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const value = rustGenericCallableValue(carrier);
  if (value === undefined) return carrier;
  const origin = rustCallableOrigin(ast, declaration);
  return origin === undefined ? undefined : rustGenericCallableCarrier({ ...value, origin });
}
