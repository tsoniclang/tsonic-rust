import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustSourceUnionCarrierValue } from "../../../target-model/types/index.js";
import { rustSourceItemIdentity } from "../../../target-model/names/source-output-identities.js";
import type { RustTypeRenderingContext } from "./render.js";
import { rustNativeSourceItemPath, rustNativeStructuralTypePath } from "../../../policy/types/model/native-type-selection.js";

export function rustSourceTypePathInContext(
  value: { readonly fileName: string; readonly typeName: string },
  context: RustTypeRenderingContext,
): string | undefined {
  return rustNativeSourceItemPath(value, {
    moduleName: context.moduleName, crateName: context.crateName, moduleNameByFileName: context.moduleNameByFileName,
    externalCrateNameByFileName: context.externalCrateNameByFileName,
    nativeTypeItemFor: (fileName, sourceName) => context.input.program.sourcePackageFacades.nativeTypeItemFor(fileName, sourceName),
    externalPublicPathFor: (fileName, typeName) => context.externalItemPathByIdentity.get(rustSourceItemIdentity(fileName, typeName)),
  });
}

export function rustStructuralTypePathInContext(carrier: TargetTypeRef, context: RustTypeRenderingContext): string | undefined {
  const union = rustSourceUnionCarrierValue(carrier);
  const definition = union?.origin === "generated"
    ? context.input.program.structuralShapes.unionForCarrier(carrier)
    : context.input.program.structuralShapes.definitionForCarrier(carrier);
  if (definition === undefined) return undefined;
  return rustNativeStructuralTypePath({ targetName: definition.targetName,
    externalModuleName: context.externalStructuralShapeModuleByFileName.get(definition.ownerFileName),
    externalCrate: context.externalCrateNameByFileName.get(definition.ownerFileName), currentCrate: context.crateName,
    currentModuleName: context.moduleName, structuralShapesModuleName: context.structuralShapesModuleName });
}
