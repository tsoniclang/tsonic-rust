import type {
  ProviderExportDeclaration,
  ProviderMemberDeclaration,
  ProviderParameterDeclaration,
  ProviderTypeExpression,
} from "@tsonic/tsts";
import type {
  RustProviderOperationDefinition,
  RustProviderPackageDefinition,
} from "../../source/provider-packages/index.js";
import {
  rustOptionTargetId,
  rustUsizeTargetId,
} from "../../source/rust-target-types.js";

export const rustStdProviderPackageId = "rust-standard-library";
export const rustStdProviderVersion = "1.0.0";
export const rustStdCollectionsModule = "@tsonic/rust/std/collections.js";
export const rustStdVecModule = "@tsonic/rust/std/vec.js";
export const rustStdHashMapTargetId = "rust.std.collections.HashMap";
export const rustStdHashSetTargetId = "rust.std.collections.HashSet";
export const rustStdVecTargetId = "rust.std.vec.Vec";

const voidSource = { kind: "void" } as const;
const boolSource = { kind: "source-primitive", name: "bool" } as const;
const nativeUintSource = { kind: "source-primitive", name: "native-uint" } as const;
const unitCarrier = { kind: "tuple", elements: [] } as const;
const boolCarrier = { kind: "source-primitive", name: "bool" } as const;
const usizeCarrier = { kind: "target-named", id: rustUsizeTargetId } as const;

export function rustStdProviderDefinition(): RustProviderPackageDefinition {
  const collections = collectionDefinitions();
  const vector = vectorDefinitions();
  return Object.freeze({
    id: rustStdProviderPackageId,
    displayName: "Rust standard library",
    version: rustStdProviderVersion,
    modules: Object.freeze([
      Object.freeze({
        moduleSpecifier: rustStdCollectionsModule,
        providerModuleId: "rust.std.collections",
        exports: Object.freeze(collections.exports),
      }),
      Object.freeze({
        moduleSpecifier: rustStdVecModule,
        providerModuleId: "rust.std.vec",
        exports: Object.freeze(vector.exports),
      }),
    ]),
    types: Object.freeze([
      { exportId: collections.hashMapExportId, targetTypeId: "rust.std.collections.HashMap" },
      { exportId: collections.hashSetExportId, targetTypeId: "rust.std.collections.HashSet" },
      { exportId: vector.vecExportId, targetTypeId: "rust.std.vec.Vec" },
    ]),
    operations: Object.freeze([...collections.operations, ...vector.operations]),
    crates: Object.freeze([]),
    carrierPaths: Object.freeze({
      "rust.std.collections.HashMap": "std::collections::HashMap",
      "rust.std.collections.HashSet": "std::collections::HashSet",
      "rust.std.vec.Vec": "std::vec::Vec",
    }),
  });
}

function collectionDefinitions(): {
  readonly hashMapExportId: string;
  readonly hashSetExportId: string;
  readonly exports: readonly ProviderExportDeclaration[];
  readonly operations: readonly RustProviderOperationDefinition[];
} {
  const hashMapExportId = rustStdHashMapTargetId;
  const hashSetExportId = rustStdHashSetTargetId;
  const hashMapCarrier = targetNamed(hashMapExportId, [typeParameter("K"), typeParameter("V")]);
  const hashSetCarrier = targetNamed(hashSetExportId, [typeParameter("T")]);
  const hashMap = genericClass(hashMapExportId, "HashMap", ["K", "V"], [
    constructorMember(hashMapExportId, []),
    methodMember(hashMapExportId, "insert", [sourceParameter("key", "K"), sourceParameter("value", "V")], optionSource("V")),
    methodMember(hashMapExportId, "len", [], nativeUintSource),
    methodMember(hashMapExportId, "is_empty", [], boolSource),
    methodMember(hashMapExportId, "clear", [], voidSource),
  ]);
  const hashSet = genericClass(hashSetExportId, "HashSet", ["T"], [
    constructorMember(hashSetExportId, []),
    methodMember(hashSetExportId, "insert", [sourceParameter("value", "T")], boolSource),
    methodMember(hashSetExportId, "len", [], nativeUintSource),
    methodMember(hashSetExportId, "is_empty", [], boolSource),
    methodMember(hashSetExportId, "clear", [], voidSource),
  ]);
  return {
    hashMapExportId,
    hashSetExportId,
    exports: [hashMap, hashSet],
    operations: [
      constructorOperation(hashMapExportId, "std::collections::HashMap::new", hashMapCarrier, ["K", "V"]),
      receiverOperation(hashMapExportId, "insert", "insert", hashMapCarrier, [typeParameter("K"), typeParameter("V")], optionCarrier("V"), ["K", "V"], true),
      receiverOperation(hashMapExportId, "len", "len", hashMapCarrier, [], usizeCarrier, ["K", "V"]),
      receiverOperation(hashMapExportId, "is_empty", "is_empty", hashMapCarrier, [], boolCarrier, ["K", "V"]),
      receiverOperation(hashMapExportId, "clear", "clear", hashMapCarrier, [], unitCarrier, ["K", "V"], true),
      constructorOperation(hashSetExportId, "std::collections::HashSet::new", hashSetCarrier, ["T"]),
      receiverOperation(hashSetExportId, "insert", "insert", hashSetCarrier, [typeParameter("T")], boolCarrier, ["T"], true),
      receiverOperation(hashSetExportId, "len", "len", hashSetCarrier, [], usizeCarrier, ["T"]),
      receiverOperation(hashSetExportId, "is_empty", "is_empty", hashSetCarrier, [], boolCarrier, ["T"]),
      receiverOperation(hashSetExportId, "clear", "clear", hashSetCarrier, [], unitCarrier, ["T"], true),
    ],
  };
}

function vectorDefinitions(): {
  readonly vecExportId: string;
  readonly exports: readonly ProviderExportDeclaration[];
  readonly operations: readonly RustProviderOperationDefinition[];
} {
  const vecExportId = rustStdVecTargetId;
  const vecCarrier = targetNamed(vecExportId, [typeParameter("T")]);
  return {
    vecExportId,
    exports: [genericClass(vecExportId, "Vec", ["T"], [
      constructorMember(vecExportId, []),
      methodMember(vecExportId, "push", [sourceParameter("value", "T")], voidSource),
      methodMember(vecExportId, "pop", [], optionSource("T")),
      methodMember(vecExportId, "len", [], nativeUintSource),
      methodMember(vecExportId, "is_empty", [], boolSource),
      methodMember(vecExportId, "clear", [], voidSource),
    ])],
    operations: [
      constructorOperation(vecExportId, "std::vec::Vec::new", vecCarrier, ["T"]),
      receiverOperation(vecExportId, "push", "push", vecCarrier, [typeParameter("T")], unitCarrier, ["T"], true),
      receiverOperation(vecExportId, "pop", "pop", vecCarrier, [], optionCarrier("T"), ["T"], true),
      receiverOperation(vecExportId, "len", "len", vecCarrier, [], usizeCarrier, ["T"]),
      receiverOperation(vecExportId, "is_empty", "is_empty", vecCarrier, [], boolCarrier, ["T"]),
      receiverOperation(vecExportId, "clear", "clear", vecCarrier, [], unitCarrier, ["T"], true),
    ],
  };
}

function genericClass(
  id: string,
  name: string,
  typeParameters: readonly string[],
  members: readonly ProviderMemberDeclaration[],
): ProviderExportDeclaration {
  return Object.freeze({
    id,
    name,
    exportName: name,
    kind: "class",
    typeParameters: Object.freeze(typeParameters.map((parameterName) => Object.freeze({ name: parameterName }))),
    members: Object.freeze(members),
  });
}

function constructorMember(ownerId: string, parameters: readonly ProviderParameterDeclaration[]): ProviderMemberDeclaration {
  const memberId = `${ownerId}.constructor`;
  return Object.freeze({
    id: memberId,
    name: "constructor",
    kind: "constructor",
    signatures: Object.freeze([Object.freeze({
      id: `${memberId}.signature`,
      parameters: Object.freeze(parameters),
    })]),
  });
}

function methodMember(
  ownerId: string,
  name: string,
  parameters: readonly ProviderParameterDeclaration[],
  returnType: ProviderTypeExpression,
): ProviderMemberDeclaration {
  const memberId = `${ownerId}.${name}`;
  return Object.freeze({
    id: memberId,
    name,
    kind: "method",
    signatures: Object.freeze([Object.freeze({
      id: `${memberId}.signature`,
      parameters: Object.freeze(parameters),
      returnType,
    })]),
  });
}

function constructorOperation(
  exportId: string,
  path: string,
  resultCarrier: RustProviderOperationDefinition["resultCarrier"],
  typeParameters: readonly string[],
): RustProviderOperationDefinition {
  return Object.freeze({
    exportId,
    memberId: `${exportId}.constructor`,
    signatureId: `${exportId}.constructor.signature`,
    operationKind: "constructor",
    target: { form: "call" as const, path },
    resultCarrier,
    parameterCarriers: Object.freeze([]),
    typeParameters: Object.freeze(typeParameters),
  });
}

function receiverOperation(
  exportId: string,
  memberName: string,
  targetName: string,
  receiverCarrier: RustProviderOperationDefinition["resultCarrier"],
  parameterCarriers: readonly RustProviderOperationDefinition["resultCarrier"][],
  resultCarrier: RustProviderOperationDefinition["resultCarrier"],
  typeParameters: readonly string[],
  mutatesReceiver = false,
): RustProviderOperationDefinition {
  return Object.freeze({
    exportId,
    memberId: `${exportId}.${memberName}`,
    signatureId: `${exportId}.${memberName}.signature`,
    operationKind: "method",
    target: {
      form: "receiver-method" as const,
      name: targetName,
      ...(mutatesReceiver ? { mutatesReceiver: true } : {}),
    },
    resultCarrier,
    parameterCarriers: Object.freeze(parameterCarriers),
    receiverCarrier,
    typeParameters: Object.freeze(typeParameters),
  });
}

function sourceParameter(name: string, typeName: string): ProviderParameterDeclaration {
  return Object.freeze({ name, type: { kind: "type-parameter" as const, name: typeName } });
}

function optionSource(typeName: string): ProviderTypeExpression {
  return {
    kind: "union",
    types: [
      { kind: "type-parameter", name: typeName },
      { kind: "undefined" },
    ],
  };
}

function typeParameter(name: string): RustProviderOperationDefinition["resultCarrier"] {
  return { kind: "type-parameter", name };
}

function targetNamed(
  id: string,
  typeArguments: readonly RustProviderOperationDefinition["resultCarrier"][],
): RustProviderOperationDefinition["resultCarrier"] {
  return { kind: "target-named", id, typeArguments };
}

function optionCarrier(typeName: string): RustProviderOperationDefinition["resultCarrier"] {
  return targetNamed(rustOptionTargetId, [typeParameter(typeName)]);
}
