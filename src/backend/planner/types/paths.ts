import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustSourceUnionCarrierValue } from "../../../target-model/types/index.js";
import { rustSourceItemIdentity } from "../../../target-model/names/source-output-identities.js";
import type { RustTypeRenderingContext } from "./render.js";

export function rustSourceTypePathInContext(
  value: { readonly fileName: string; readonly typeName: string },
  context: RustTypeRenderingContext,
): string | undefined {
  const moduleName = context.moduleNameByFileName.get(value.fileName);
  if (moduleName === undefined) return undefined;
  const protocol = context.input.program.callableValues.native.protocolForSourceItem(value.fileName, value.typeName);
  const typeName = protocol?.targetName ?? context.input.program.names.nameForSourceType(value.fileName, value.typeName);
  if (typeName === undefined) return undefined;
  const externalCrate = context.externalCrateNameByFileName.get(value.fileName);
  return protocol !== undefined
    ? `${externalCrate !== undefined && externalCrate !== context.crateName ? externalCrate : "crate"}::${moduleName}::${typeName}`
    : externalCrate !== undefined && externalCrate !== context.crateName
    ? context.externalItemPathByIdentity.get(rustSourceItemIdentity(value.fileName, typeName))
    : moduleName === context.moduleName ? typeName : `crate::${moduleName}::${typeName}`;
}

export function rustStructuralTypePathInContext(carrier: TargetTypeRef, context: RustTypeRenderingContext): string | undefined {
  const union = rustSourceUnionCarrierValue(carrier);
  const definition = union?.origin === "generated"
    ? context.input.program.structuralShapes.unionForCarrier(carrier)
    : context.input.program.structuralShapes.definitionForCarrier(carrier);
  if (definition === undefined) return undefined;
  const moduleName = context.externalStructuralShapeModuleByFileName.get(definition.ownerFileName);
  const crateName = context.externalCrateNameByFileName.get(definition.ownerFileName);
  return moduleName !== undefined && crateName !== context.crateName
    ? `${moduleName}::${definition.targetName}`
    : context.moduleName === context.structuralShapesModuleName
    ? definition.targetName
    : `crate::${context.structuralShapesModuleName}::${definition.targetName}`;
}
