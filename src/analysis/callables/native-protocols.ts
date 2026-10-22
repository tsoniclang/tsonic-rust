import { createHash } from "node:crypto";

import type { TargetTypeRef } from "../../target-model/types/model.js";

import { rustTypeGenericArguments } from "../../target-model/types/generic-arguments.js";

import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";

import type { RustNativeCallableProtocol, RustNativeCallableProtocolBinding } from "../../target-model/records/native-protocols.js";

export interface RustNativeCallableProtocolRegistry {
  bind(ownerFileName: string, carrier: TargetTypeRef): RustNativeCallableProtocolBinding | undefined;
  definitions(): readonly RustNativeCallableProtocol[];
}

export function createRustNativeCallableProtocolRegistry(input: {
  readonly definitions: RustTypeDefinitions;
  readonly usedNames: Set<string>;
}): RustNativeCallableProtocolRegistry {
  const protocols = new Map<string, RustNativeCallableProtocol>();
  return Object.freeze({
    bind(ownerFileName: string, source: TargetTypeRef): RustNativeCallableProtocolBinding | undefined {
      if (ownerFileName.length === 0) return undefined;
      const binding = selectRustNativeCallableProtocolSignature(source, input.definitions);
      if (binding === undefined) return undefined;
      const { method, completion } = binding;
      const contract = { ownerFileName, signature: binding.signature, method,
        ...(completion === undefined ? {} : { completion }) };
      const key = closedMetadataKey({ ...contract, method: binding.identityMethod });
      let protocol = protocols.get(key);
      if (protocol === undefined) {
        const identity = `${rustNativeCallableProtocolIdPrefix}${createHash("sha256").update(key).digest("hex")}`;
        const result = selectRustNativeCallableProtocolResult({ ...contract, identity }, input.definitions);
        if (result === undefined) return undefined;
        const targetName = allocateRustGeneratedName(input.usedNames, `NativeCallable_${identity.slice(-16)}`);
        protocol = snapshotClosedMetadata({ ...contract, identity, targetName, result,
          ...(method.binder.parameters.length === 0 ? {} : {
            boundProducerName: allocateRustGeneratedName(input.usedNames, `${targetName}Bound`),
          }),
          trait: { kind: "trait-ref", id: identity, path: targetName,
            sourceItem: { fileName: ownerFileName, typeName: targetName },
            genericArguments: rustTypeGenericArguments(binding.signature.environmentParameters), associatedConstraints: [] },
        });
        protocols.set(key, protocol);
      }
      return Object.freeze({ protocol, environment: snapshotClosedMetadata(binding.environment),
        trait: snapshotClosedMetadata({ ...protocol.trait, genericArguments: rustTypeGenericArguments(binding.environment) }) });
    },
    definitions: () => Object.freeze([...protocols.values()]),
  });
}

import { selectRustNativeCallableProtocolSignature, selectRustNativeCallableProtocolResult } from "../../policy/types/callables/native-protocols.js";
import { rustNativeCallableProtocolIdPrefix } from "../../target-model/records/native-protocols.js";
