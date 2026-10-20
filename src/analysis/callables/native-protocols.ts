import { createHash } from "node:crypto";

import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustCallableSignatureBinding } from "../../target-model/types/carriers/callable-signatures.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustTypeGenericArguments } from "../../target-model/types/generic-arguments.js";

import { rustNativeCallableCompletion } from "../../target-model/types/callable-completions.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import { bindRustCallableInputLifetimes } from "../../target-model/types/carriers/callable-input-lifetimes.js";

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
      const carrier = rustOptionElementCarrier(source) ?? source;
      const generic = rustGenericCallableValue(carrier);
      const ordinary = rustCallableProtocol(carrier);
      const binding = generic === undefined ? ordinary === undefined ? undefined :
        rustCallableSignatureBinding([], ordinary.parameters, ordinary.result) :
        { signature: generic.signature, environment: generic.environment };
      if (binding === undefined) return undefined;
      const selectedMethod = bindRustCallableInputLifetimes(binding.signature.parameters, binding.signature.result);
      if (selectedMethod === undefined) return undefined;
      const method = Object.freeze({ ...selectedMethod, outlives: selectRustNativeCallableOutlivesBounds(selectedMethod) });
      const completion = rustNativeCallableCompletion(method.result, input.definitions);
      const contract = { ownerFileName, signature: binding.signature, method,
        ...(completion === undefined ? {} : { completion }) };
      const key = closedMetadataKey({ ...contract, method: selectedMethod });
      let protocol = protocols.get(key);
      if (protocol === undefined) {
        const identity = `native-protocol:${createHash("sha256").update(key).digest("hex")}`;
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

import { selectRustNativeCallableOutlivesBounds, selectRustNativeCallableProtocolResult } from "../../policy/types/callables/native-protocols.js";
