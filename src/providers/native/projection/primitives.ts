import { projectAssociatedConstants, projectTypeMethods } from "./declaration-members.js";
import { selectUnambiguousMembers } from "./functions.js";
import { sourceTypeFor, targetTypeFor } from "./types.js";
import type { ProviderExportDeclaration } from "@tsonic/tsts";
import type { RustCompilerExport, RustCompilerFunction, RustCompilerType } from "../model/model.js";
import type { ProjectionContext } from "./model.js";
import type { RustProviderOperationDefinition } from "../../packages/model.js";

export function projectPrimitiveExport(
  exported: Extract<RustCompilerExport, { readonly kind: "primitive" }>,
  context: ProjectionContext,
  exportId: string,
): {
  readonly declaration: ProviderExportDeclaration;
  readonly operations: readonly RustProviderOperationDefinition[];
} {
  const targetPath = Object.freeze(["core", "primitive", exported.type.name]);
  const typeContext: ProjectionContext = {
    ...context,
    currentType: {
      exportId,
      name: exported.name,
      carrier: targetTypeFor(exported.type, context, "result"),
      sourceType: sourceTypeFor(exported.type, context, "result"),
      genericParameters: [],
      canonicalPath: exported.canonicalPath,
      targetPath,
    },
  };
  const methods = projectTypeMethods(exported.methods.map(method => explicitReceiver(method, exported.type)),
    "primitive", typeContext, exportId, targetPath);
  const constants = projectAssociatedConstants(exported.associatedConstants, typeContext, exportId);
  const selected = selectUnambiguousMembers([...methods.members, ...constants.members],
    [...methods.operations, ...constants.operations]);
  return {
    declaration: Object.freeze({ id: exportId, name: exported.name, exportName: exported.name,
      kind: "namespace", members: selected.members.map(({ static: _static, ...member }) => Object.freeze(member)) }),
    operations: selected.operations,
  };
}

function explicitReceiver(method: RustCompilerFunction, owner: RustCompilerType): RustCompilerFunction {
  const receiver = method.receiver;
  if (receiver === undefined || receiver.kind === "custom") return method;
  const type: RustCompilerType = receiver.kind === "value" ? owner : {
    kind: "reference", mutable: receiver.kind === "mutable", lifetime: receiver.lifetime, target: owner,
  };
  return Object.freeze({ ...method, receiver: Object.freeze({ kind: "custom", type }) });
}
