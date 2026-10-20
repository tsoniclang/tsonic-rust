import type { ProviderExportDeclaration, ProviderMemberDeclaration, ProviderParameterDeclaration, ProviderSignatureDeclaration, ProviderTypeExpression, ProviderTypeParameterDeclaration } from "@tsonic/tsts";

export function rebaseProviderExport(
  declaration: ProviderExportDeclaration,
  canonicalModuleSpecifier: string,
  publicModuleSpecifier: string,
): ProviderExportDeclaration {
  const mapType = (type: ProviderTypeExpression): ProviderTypeExpression =>
    rebaseProviderType(type, canonicalModuleSpecifier, publicModuleSpecifier);
  return {
    ...declaration,
    ...(declaration.type === undefined ? {} : { type: mapType(declaration.type) }),
    ...(declaration.typeParameters === undefined
      ? {}
      : { typeParameters: declaration.typeParameters.map((parameter) => rebaseProviderTypeParameter(parameter, mapType)) }),
    ...(declaration.heritage === undefined
      ? {}
      : { heritage: declaration.heritage.map((entry) => ({ ...entry, type: mapType(entry.type) })) }),
    ...(declaration.signatures === undefined
      ? {}
      : { signatures: declaration.signatures.map((signature) => rebaseProviderSignature(signature, mapType)) }),
    ...(declaration.members === undefined
      ? {}
      : { members: declaration.members.map((member) => rebaseProviderMember(member, mapType)) }),
  };
}

function rebaseProviderMember(
  member: ProviderMemberDeclaration,
  mapType: (type: ProviderTypeExpression) => ProviderTypeExpression,
): ProviderMemberDeclaration {
  return {
    ...member,
    ...(member.type === undefined ? {} : { type: mapType(member.type) }),
    ...(member.signatures === undefined
      ? {}
      : { signatures: member.signatures.map((signature) => rebaseProviderSignature(signature, mapType)) }),
  };
}

function rebaseProviderSignature(
  signature: ProviderSignatureDeclaration,
  mapType: (type: ProviderTypeExpression) => ProviderTypeExpression,
): ProviderSignatureDeclaration {
  return {
    ...signature,
    parameters: signature.parameters.map((parameter) => rebaseProviderParameter(parameter, mapType)),
    ...(signature.returnType === undefined ? {} : { returnType: mapType(signature.returnType) }),
    ...(signature.typeParameters === undefined
      ? {}
      : { typeParameters: signature.typeParameters.map((parameter) => rebaseProviderTypeParameter(parameter, mapType)) }),
  };
}

function rebaseProviderParameter(
  parameter: ProviderParameterDeclaration,
  mapType: (type: ProviderTypeExpression) => ProviderTypeExpression,
): ProviderParameterDeclaration {
  return {
    ...parameter,
    type: mapType(parameter.type),
    ...(parameter.defaultType === undefined ? {} : { defaultType: mapType(parameter.defaultType) }),
  };
}

function rebaseProviderTypeParameter(
  parameter: ProviderTypeParameterDeclaration,
  mapType: (type: ProviderTypeExpression) => ProviderTypeExpression,
): ProviderTypeParameterDeclaration {
  return {
    ...parameter,
    ...(parameter.constraints === undefined ? {} : { constraints: parameter.constraints.map(mapType) }),
    ...(parameter.defaultType === undefined ? {} : { defaultType: mapType(parameter.defaultType) }),
  };
}

function rebaseProviderType(
  type: ProviderTypeExpression,
  canonicalModuleSpecifier: string,
  publicModuleSpecifier: string,
): ProviderTypeExpression {
  const mapType = (nested: ProviderTypeExpression): ProviderTypeExpression =>
    rebaseProviderType(nested, canonicalModuleSpecifier, publicModuleSpecifier);
  switch (type.kind) {
    case "provider-ref":
      return {
        ...type,
        moduleSpecifier: type.moduleSpecifier === canonicalModuleSpecifier
          ? publicModuleSpecifier
          : type.moduleSpecifier,
        ...(type.typeArguments === undefined ? {} : { typeArguments: type.typeArguments.map(mapType) }),
      };
    case "source-global":
      return {
        ...type,
        ...(type.typeArguments === undefined ? {} : { typeArguments: type.typeArguments.map(mapType) }),
      };
    case "array":
      return { ...type, elementType: mapType(type.elementType) };
    case "tuple":
      return { ...type, elementTypes: type.elementTypes.map(mapType) };
    case "union":
    case "intersection":
      return { ...type, types: type.types.map(mapType) };
    case "function":
      return {
        ...type,
        parameters: type.parameters.map((parameter) => rebaseProviderParameter(parameter, mapType)),
        returnType: mapType(type.returnType),
        ...(type.typeParameters === undefined
          ? {}
          : { typeParameters: type.typeParameters.map((parameter) => rebaseProviderTypeParameter(parameter, mapType)) }),
      };
    case "any":
    case "unknown":
    case "void":
    case "never":
    case "undefined":
    case "boolean":
    case "string":
    case "number":
    case "bigint":
    case "object":
    case "literal":
    case "bigint-literal":
    case "source-primitive":
    case "type-parameter":
      return type;
  }
}
