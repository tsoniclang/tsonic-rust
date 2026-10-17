import assert from "node:assert/strict";
import { rustNativeProjectGeneratedCarrier, rustNativeTypeSelectionInput } from "../../dist/policy/types/model/native-type-selection.js";
import { selectRustOptionalStorageTypeArguments } from "../../dist/analysis/declarations/type-projections.js";
import { rustSourceItemIdentity } from "../../dist/analysis/program/source-package-facades.js";
import { closedMetadataKey } from "../../dist/target-model/metadata/closed-data.js";

export function selectedNativeErrorBoundaries({ components = [], native = [] }) {
  const componentBoundaries = new Map(components.map(([consumer, owner, boundary]) =>
    [closedMetadataKey([consumer, owner]), boundary]));
  const nativeBoundaries = new Map(native.map(([consumer, owner, boundary]) =>
    [closedMetadataKey([consumer, owner]), boundary]));
  const nativeBoundaryFor = (consumer, owner) => nativeBoundaries.get(closedMetadataKey([consumer, owner]));
  return {
    componentBoundaries, nativeBoundaries,
    componentBoundaryFor: (consumer, owner) => componentBoundaries.get(closedMetadataKey([consumer, owner])),
    nativeBoundaryFor,
    physicalBoundaryFor: (consumer, owner) => owner?.kind === "physical" ? nativeBoundaryFor(consumer, owner) : undefined,
  };
}

export function nativeDeclarationSelectionInput(program) {
  const identities = program.sourceOutputIdentities;
  const components = program.sourcePackageComponents;
  const moduleNameByFileName = new Map([...identities].map(([file, identity]) => [file, identity.moduleName]));
  const externalCrateNameByFileName = new Map([...identities].flatMap(([file, identity]) =>
    identity.externalCrateName === undefined ? [] : [[file, identity.externalCrateName]]));
  const externalStructuralShapeModuleByFileName = new Map([...identities].flatMap(([file, identity]) => {
    const component = components.forComponent(identity.componentId);
    return identity.externalCrateName === undefined || component === undefined ? []
      : [[file, `${identity.externalCrateName}::${component.structuralShapesModuleName}`]];
  }));
  const contextFor = (fileName, typeParameterNames) => {
    const identity = identities.get(fileName);
    assert.equal(identity !== undefined, true, "fixture uses the actual selected source output identity");
    const component = components.forComponent(identity.componentId);
    assert.equal(component !== undefined, true, "fixture uses the actual selected source component");
    return {
      moduleName: identity.moduleName, crateName: identity.externalCrateName, typeParameterNames,
      moduleNameByFileName, externalCrateNameByFileName, externalStructuralShapeModuleByFileName,
      structuralShapesModuleName: component.structuralShapesModuleName,
      externalPublicPathFor: (file, name) => program.sourcePackageFacades.externalItemPathByIdentity.get(rustSourceItemIdentity(file, name)),
      nativeTypeItemFor: (file, name) => program.sourcePackageFacades.nativeTypeItemFor(file, name),
      typeDefinitions: program.typeDefinitions, projectTypes: program.projectTypes,
      objectRepresentations: program.objectRepresentations, structuralShapes: program.structuralShapes,
      callableValues: program.callableValues, classValues: program.classValues, errorRegions: program.errorRegions,
      additionalArgumentsFor: (carrier, indexes) => selectRustOptionalStorageTypeArguments(carrier, {
        genericRequirements: program.declarationGenericRequirements, projectTypes: program.projectTypes,
        normalize: program.typeFamilies.normalize,
      }, indexes),
      programErrorBoundaryFor: owner => program.errorTransport.nativeBoundaryFor(component.componentId, owner),
    };
  };
  return {
    nativeTypeInputFor: (file, names) => rustNativeTypeSelectionInput(contextFor(file, names)),
    nativeStateCarrierFor: definition => rustNativeProjectGeneratedCarrier(program.projectTypes.openCarrier(definition),
      definition.stateName, contextFor(definition.fileName, undefined)),
  };
}
