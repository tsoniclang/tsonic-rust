import type {
  ProviderExportDeclaration,
  ProviderMemberDeclaration,
  ProviderParameterDeclaration,
  ProviderSignatureDeclaration,
  ProviderTypeExpression,
} from "@tsonic/tsts";
import {
  rustDeclarationBuilderExportId,
  rustDeclarationBuilderMemberIds,
  rustDeclarationBuilderSignatureIds,
  rustSourceOperationExportIds,
  rustSourceOperationSignatureIds,
  rustSourceNativeUintExportId,
  rustSourceTypeExportIds,
  rustTypesModule,
} from "../identity.js";

const typeParameter = (name: string): ProviderTypeExpression => ({
  kind: "type-parameter",
  name,
});

const rustType = (
  exportName: string,
  typeArguments: readonly ProviderTypeExpression[] = [],
): ProviderTypeExpression => ({
  kind: "provider-ref",
  moduleSpecifier: rustTypesModule,
  exportName,
  ...(typeArguments.length === 0 ? {} : { typeArguments }),
});

const valueType = typeParameter("T");
const sharedReference = rustType(rustSourceTypeExportIds.sharedReference, [valueType]);
const mutableReference = rustType(rustSourceTypeExportIds.mutableReference, [valueType]);
const ownedValue = rustType(rustSourceTypeExportIds.owned, [valueType]);
const constPointer = rustType(rustSourceTypeExportIds.constPointer, [valueType]);
const mutablePointer = rustType(rustSourceTypeExportIds.mutablePointer, [valueType]);
const nativeUint = rustType(rustSourceNativeUintExportId);

export function rustSemanticOperationDeclarations(): readonly ProviderExportDeclaration[] {
  return [
    unaryValueOperation(
      rustSourceOperationExportIds.sharedBorrow,
      rustSourceOperationSignatureIds.sharedBorrow,
      valueType,
      sharedReference,
    ),
    unaryValueOperation(
      rustSourceOperationExportIds.mutableBorrow,
      rustSourceOperationSignatureIds.mutableBorrow,
      valueType,
      mutableReference,
    ),
    unaryValueOperation(
      rustSourceOperationExportIds.move,
      rustSourceOperationSignatureIds.move,
      valueType,
      ownedValue,
    ),
    unaryValueOperation(
      rustSourceOperationExportIds.clone,
      rustSourceOperationSignatureIds.clone,
      valueType,
      ownedValue,
    ),
    unaryValueOperation(
      rustSourceOperationExportIds.own,
      rustSourceOperationSignatureIds.own,
      sharedReference,
      ownedValue,
    ),
    functionDeclaration(rustSourceOperationExportIds.load, [
      signature(
        rustSourceOperationSignatureIds.loadShared,
        [{ name: "reference", type: sharedReference }],
        valueType,
      ),
      signature(
        rustSourceOperationSignatureIds.loadMutable,
        [{ name: "reference", type: mutableReference }],
        valueType,
      ),
    ]),
    binaryValueOperation(
      rustSourceOperationExportIds.store,
      rustSourceOperationSignatureIds.store,
      mutableReference,
      valueType,
      { kind: "void" },
    ),
    binaryValueOperation(
      rustSourceOperationExportIds.replace,
      rustSourceOperationSignatureIds.replace,
      mutableReference,
      valueType,
      valueType,
    ),
    unaryValueOperation(
      rustSourceOperationExportIds.take,
      rustSourceOperationSignatureIds.take,
      mutableReference,
      valueType,
    ),
    functionDeclaration(rustSourceOperationExportIds.captureMove, [Object.freeze({
      id: rustSourceOperationSignatureIds.captureMove,
      typeParameters: [{ name: "F" }],
      parameters: [{ name: "callback", type: typeParameter("F") }],
      returnType: typeParameter("F"),
    })]),
    declarationBuilderType(),
    declarationBuilderRoot(),
    functionDeclaration(rustSourceOperationExportIds.exposePointerAddress, [
      signature(
        rustSourceOperationSignatureIds.exposeConstPointerAddress,
        [{ name: "pointer", type: constPointer }],
        nativeUint,
      ),
      signature(
        rustSourceOperationSignatureIds.exposeMutablePointerAddress,
        [{ name: "pointer", type: mutablePointer }],
        nativeUint,
      ),
    ]),
    unaryValueOperation(
      rustSourceOperationExportIds.constPointerFromExposedAddress,
      rustSourceOperationSignatureIds.constPointerFromExposedAddress,
      nativeUint,
      constPointer,
    ),
    unaryValueOperation(
      rustSourceOperationExportIds.mutablePointerFromExposedAddress,
      rustSourceOperationSignatureIds.mutablePointerFromExposedAddress,
      nativeUint,
      mutablePointer,
    ),
    unaryValueOperation(
      rustSourceOperationExportIds.readVolatile,
      rustSourceOperationSignatureIds.readVolatile,
      constPointer,
      valueType,
    ),
    binaryValueOperation(
      rustSourceOperationExportIds.writeVolatile,
      rustSourceOperationSignatureIds.writeVolatile,
      mutablePointer,
      valueType,
      { kind: "void" },
    ),
  ];
}

function unaryValueOperation(
  exportName: string,
  signatureId: string,
  input: ProviderTypeExpression,
  output: ProviderTypeExpression,
): ProviderExportDeclaration {
  return functionDeclaration(exportName, [signature(
    signatureId,
    [{ name: "value", type: input }],
    output,
  )]);
}

function binaryValueOperation(
  exportName: string,
  signatureId: string,
  first: ProviderTypeExpression,
  second: ProviderTypeExpression,
  output: ProviderTypeExpression,
): ProviderExportDeclaration {
  return functionDeclaration(exportName, [signature(
    signatureId,
    [
      { name: "reference", type: first },
      { name: "value", type: second },
    ],
    output,
  )]);
}

function signature(
  id: string,
  parameters: readonly ProviderParameterDeclaration[],
  returnType: ProviderTypeExpression,
): ProviderSignatureDeclaration {
  return Object.freeze({
    id,
    typeParameters: [{ name: "T" }],
    parameters: parameters.map((parameter) => Object.freeze(parameter)),
    returnType,
  });
}

function functionDeclaration(
  name: string,
  signatures: readonly ProviderSignatureDeclaration[],
): ProviderExportDeclaration {
  return Object.freeze({
    id: name,
    name,
    kind: "function",
    signatures: [...signatures],
  });
}

function builderType(type: ProviderTypeExpression): ProviderTypeExpression {
  return {
    kind: "provider-ref",
    moduleSpecifier: "@tsonic/rust/lang.js",
    exportName: rustDeclarationBuilderExportId,
    typeArguments: [type],
  };
}

function declarationBuilderType(): ProviderExportDeclaration {
  const builder = builderType(valueType);
  const noArgument = (
    memberId: string,
    signatureId: string,
  ): ProviderMemberDeclaration => Object.freeze({
    id: memberId,
    name: memberId.slice(memberId.lastIndexOf(".") + 1),
    kind: "method",
    signatures: [Object.freeze({
      id: signatureId,
      parameters: [],
      returnType: builder,
    })],
  });
  const valueArgument = (
    memberId: string,
    signatureId: string,
    parameterName: string,
    parameterType: ProviderTypeExpression,
  ): ProviderMemberDeclaration => Object.freeze({
    id: memberId,
    name: memberId.slice(memberId.lastIndexOf(".") + 1),
    kind: "method",
    signatures: [Object.freeze({
      id: signatureId,
      parameters: [{ name: parameterName, type: parameterType }],
      returnType: builder,
    })],
  });
  return Object.freeze({
    id: rustDeclarationBuilderExportId,
    name: rustDeclarationBuilderExportId,
    kind: "interface",
    typeParameters: [{ name: "T" }],
    members: [
      valueArgument(
        rustDeclarationBuilderMemberIds.extern,
        rustDeclarationBuilderSignatureIds.extern,
        "abi",
        { kind: "string" },
      ),
      noArgument(
        rustDeclarationBuilderMemberIds.variadic,
        rustDeclarationBuilderSignatureIds.variadic,
      ),
      noArgument(
        rustDeclarationBuilderMemberIds.reprC,
        rustDeclarationBuilderSignatureIds.reprC,
      ),
      noArgument(
        rustDeclarationBuilderMemberIds.reprTransparent,
        rustDeclarationBuilderSignatureIds.reprTransparent,
      ),
      valueArgument(
        rustDeclarationBuilderMemberIds.reprPacked,
        rustDeclarationBuilderSignatureIds.reprPacked,
        "alignment",
        { kind: "number" },
      ),
      valueArgument(
        rustDeclarationBuilderMemberIds.reprAlign,
        rustDeclarationBuilderSignatureIds.reprAlign,
        "alignment",
        { kind: "number" },
      ),
      noArgument(
        rustDeclarationBuilderMemberIds.union,
        rustDeclarationBuilderSignatureIds.union,
      ),
      noArgument(
        rustDeclarationBuilderMemberIds.mutableStatic,
        rustDeclarationBuilderSignatureIds.mutableStatic,
      ),
      noArgument(
        rustDeclarationBuilderMemberIds.threadLocal,
        rustDeclarationBuilderSignatureIds.threadLocal,
      ),
      noArgument(
        rustDeclarationBuilderMemberIds.unsafeTrait,
        rustDeclarationBuilderSignatureIds.unsafeTrait,
      ),
      genericBuilderMember(
        rustDeclarationBuilderMemberIds.unsafeImpl,
        rustDeclarationBuilderSignatureIds.unsafeImpl,
        builder,
      ),
      genericBuilderMember(
        rustDeclarationBuilderMemberIds.negativeImpl,
        rustDeclarationBuilderSignatureIds.negativeImpl,
        builder,
      ),
      noArgument(
        rustDeclarationBuilderMemberIds.drop,
        rustDeclarationBuilderSignatureIds.drop,
      ),
    ],
  });
}

function genericBuilderMember(
  memberId: string,
  signatureId: string,
  returnType: ProviderTypeExpression,
): ProviderMemberDeclaration {
  return Object.freeze({
    id: memberId,
    name: memberId.slice(memberId.lastIndexOf(".") + 1),
    kind: "method",
    signatures: [Object.freeze({
      id: signatureId,
      typeParameters: [{ name: "Trait" }],
      parameters: [],
      returnType,
    })],
  });
}

function declarationBuilderRoot(): ProviderExportDeclaration {
  const result = builderType(valueType);
  return functionDeclaration(rustSourceOperationExportIds.declaration, [
    Object.freeze({
      id: rustSourceOperationSignatureIds.declarationValue,
      typeParameters: [{ name: "T" }],
      parameters: [{ name: "value", type: valueType }],
      returnType: result,
    }),
    Object.freeze({
      id: rustSourceOperationSignatureIds.declarationType,
      typeParameters: [{ name: "T" }],
      parameters: [],
      returnType: result,
    }),
  ]);
}
