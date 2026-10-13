import { isTsonicSourceProfileDeclarationPath } from "@tsonic/target-api/provider";
import type { Node, ProviderDeclarationIdentity } from "@tsonic/tsts";
import { rustProviderGlobalsFileName } from "../../source/profiles/provider-globals.js";
import type { RustProviderExportRow } from "../../providers/packages/model.js";
import type { RustSourcePolicyContext } from "../model/context.js";

export function selectedRustProviderGlobal(
  declaration: Node | undefined,
  context: RustSourcePolicyContext,
  exports: readonly RustProviderExportRow[],
): ProviderDeclarationIdentity | undefined {
  const { ast } = context;
  if (declaration === undefined || !ast.is.IsVariableDeclaration(declaration)) return undefined;
  const sourceFile = ast.getSourceFile(declaration);
  const name = ast.name(declaration);
  if (sourceFile?.IsDeclarationFile !== true || name === undefined || !ast.is.IsIdentifier(name)) {
    return undefined;
  }
  const fileName = ast.getFileName(sourceFile).split("\\").join("/");
  if (!fileName.endsWith(`/${rustProviderGlobalsFileName}`)) return undefined;
  const selectedName = ast.text(name);
  const rows = exports.filter((row) => row.globalNames?.includes(selectedName) === true &&
    isTsonicSourceProfileDeclarationPath(fileName, row.providerPackageId));
  if (rows.length !== 1) return undefined;
  const row = rows[0]!;
  return {
    providerId: row.providerId,
    providerVersion: row.providerVersion,
    providerModuleId: row.providerModuleId,
    moduleSpecifier: row.moduleSpecifier,
    exportId: row.exportId,
  };
}
