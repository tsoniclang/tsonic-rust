import { closedMetadataEquals } from "../metadata/closed-data.js";
import { rustFlowReadProjectionEquals } from "../records/operations/equality.js";
import { rustTargetTypeRefEquals } from "./equality.js";
import type { RustSelectedTargetSignature } from "../records/operations/member-selections.js";

export function rustSelectedTargetSignatureEquals(
  left: RustSelectedTargetSignature,
  right: RustSelectedTargetSignature,
): boolean {
  return closedMetadataEquals(left.member, right.member) &&
    left.nativeParameterDeclarations.length === right.nativeParameterDeclarations.length &&
    left.nativeParameterDeclarations.every((parameter, index) => parameter === right.nativeParameterDeclarations[index]) &&
    rustTargetTypeRefEquals(left.sourceConstructorCarrier, right.sourceConstructorCarrier) &&
    rustTargetTypeRefEquals(left.sourceSelectedOwnerCarrier, right.sourceSelectedOwnerCarrier) &&
    rustTargetTypeRefEquals(left.sourceSelectedReceiverCarrier, right.sourceSelectedReceiverCarrier) &&
    rustTargetTypeRefEquals(left.sourceCallableCarrier, right.sourceCallableCarrier) &&
    closedMetadataEquals(left.sourceCallableParameterIndexes, right.sourceCallableParameterIndexes) &&
    closedMetadataEquals(left.sourceStructuralMethod, right.sourceStructuralMethod) &&
    closedMetadataEquals(left.targetGenericArguments, right.targetGenericArguments) &&
    closedMetadataEquals(left.providerDeclaration, right.providerDeclaration) &&
    closedMetadataEquals(left.argumentConversions, right.argumentConversions) &&
    left.sourceSignature === right.sourceSignature &&
    left.sourceDeclaration === right.sourceDeclaration &&
    left.sourceCalleeSymbol === right.sourceCalleeSymbol &&
    left.sourceCalleeDeclaration === right.sourceCalleeDeclaration &&
    left.sourceReturnType === right.sourceReturnType &&
    sourceArgumentBindingsEqual(left.sourceArgumentBindings, right.sourceArgumentBindings) &&
    sourceSelectedSignatureParametersEqual(left.sourceSelectedSignatureParameters, right.sourceSelectedSignatureParameters) &&
    sourceSelectedMethodTypeArgumentsEqual(left.sourceSelectedMethodTypeArguments, right.sourceSelectedMethodTypeArguments) &&
    resultProjectionEquals(left, right) && unionMethodsEqual(left, right);
}

function resultProjectionEquals(left: RustSelectedTargetSignature, right: RustSelectedTargetSignature): boolean {
  const projection = left.sourceResultProjection;
  return projection === undefined ? right.sourceResultProjection === undefined
    : right.sourceResultProjection !== undefined && rustFlowReadProjectionEquals(projection, right.sourceResultProjection);
}

function unionMethodsEqual(left: RustSelectedTargetSignature, right: RustSelectedTargetSignature): boolean {
  const methods = left.sourceUnionMethods;
  const other = right.sourceUnionMethods;
  if (methods === undefined || other === undefined) return methods === other;
  return rustTargetTypeRefEquals(methods.receiverCarrier, other.receiverCarrier) &&
    methods.variants.length === other.variants.length && methods.variants.every((variant, index) => {
      const selected = other.variants[index];
      return selected !== undefined && variant.name === selected.name &&
        variant.declaration === selected.declaration && variant.targetName === selected.targetName &&
        rustTargetTypeRefEquals(variant.carrier, selected.carrier) &&
        rustTargetTypeRefEquals(variant.returnType, selected.returnType) &&
        closedMetadataEquals(variant.resultConversion, selected.resultConversion);
    });
}

export function sourceArgumentBindingsEqual(
  left: RustSelectedTargetSignature["sourceArgumentBindings"],
  right: RustSelectedTargetSignature["sourceArgumentBindings"],
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return other !== undefined &&
      entry.sourceArgumentIndex === other.sourceArgumentIndex &&
      entry.effectiveArgumentIndex === other.effectiveArgumentIndex &&
      entry.sourceForm === other.sourceForm &&
      entry.spreadElementIndex === other.spreadElementIndex &&
      entry.sourceParameterIndex === other.sourceParameterIndex &&
      entry.sourceParameterForm === other.sourceParameterForm &&
      entry.selectedArgumentType === other.selectedArgumentType &&
      entry.selectedParameterType === other.selectedParameterType;
  });
}

export function sourceSelectedSignatureParametersEqual(
  left: RustSelectedTargetSignature["sourceSelectedSignatureParameters"],
  right: RustSelectedTargetSignature["sourceSelectedSignatureParameters"],
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return other !== undefined &&
      entry.parameterIndex === other.parameterIndex &&
      entry.parameterName === other.parameterName &&
      entry.parameterSymbol === other.parameterSymbol &&
      entry.parameterDeclaration === other.parameterDeclaration &&
      entry.selectedType === other.selectedType &&
      entry.authoredTypeNode === other.authoredTypeNode &&
      entry.acceptsOmission === other.acceptsOmission &&
      entry.rest === other.rest;
  });
}

export function sourceSelectedMethodTypeArgumentsEqual(
  left: RustSelectedTargetSignature["sourceSelectedMethodTypeArguments"],
  right: RustSelectedTargetSignature["sourceSelectedMethodTypeArguments"],
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return other !== undefined &&
      entry.typeParameterName === other.typeParameterName &&
      entry.typeParameter === other.typeParameter &&
      entry.selectedType === other.selectedType &&
      entry.explicitTypeNode === other.explicitTypeNode;
  });
}
