import assert from "node:assert/strict";
import { createRustNativeCallableProtocolRegistry } from "../../dist/analysis/callables/native-protocols.js";
import { planRustNativeCallableProtocol } from "../../dist/backend/planner/declarations/callables/native-protocols.js";
import { planRustNativeProducerBridge } from "../../dist/backend/planner/declarations/callables/native-producer-bridges.js";
import { createRustTypeDefinitionRegistry } from "../../dist/analysis/project-types/type-definitions.js";
import { rustCallableTargetType, rustSourceUnionCarrierValue } from "../../dist/target-model/types/index.js";
import { createRustSourceFile } from "../../dist/backend/target-ast/nodes.js";
import { finalizeRustSourceStyle } from "../../dist/backend/target-ast/normalization/source-style.js";
import { printRustSourceFile } from "./printed-rust-source.mjs";

export function nativeProducerFixture({
  parameters = [], result, carrier = rustCallableTargetType(parameters, result),
  definitions = createRustTypeDefinitionRegistry(), identity = "producer-proof", usedNames = new Set(),
  protocols = createRustNativeCallableProtocolRegistry({ definitions, usedNames }),
} = {}) {
  const protocol = protocols.bind("/index.ts", carrier)?.protocol;
  assert.equal(protocol !== undefined, true, `${identity}: protocol exists`);
  const context = {
    input: { program: {
      typeDefinitions: definitions,
      callableValues: { native: { protocolForSourceItem: (fileName, name) =>
        fileName === protocol.ownerFileName && name === protocol.targetName ? protocol : undefined },
        nativeGenericProducers: { unresolved: [], forProtocol: () => [] } },
      names: { nameForSourceType: (_fileName, name) => name },
      structuralShapes: { unionForCarrier: value => {
        const union = rustSourceUnionCarrierValue(value);
        return union === undefined || definitions.sourceUnionVariants(value) === undefined ? undefined : {
          ownerFileName: union.fileName, targetName: union.typeName,
        };
      } },
    } },
    usedAliases: new Set(), moduleName: "proof", structuralShapesModuleName: "proof",
    moduleNameByFileName: new Map([["/index.ts", "proof"]]), externalCrateNameByFileName: new Map(),
    externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map(),
  };
  return { protocol, context, definitions };
}

export function nativeProducerItems(fixture) {
  const trait = planRustNativeCallableProtocol(fixture.protocol, fixture.context);
  const bridge = planRustNativeProducerBridge(fixture.protocol, fixture.context);
  assert.equal(trait !== undefined, true, "protocol trait renders");
  assert.equal(bridge !== undefined, true, "producer bridge renders");
  return [trait, ...bridge];
}

export function printNativeProducerItems(items) {
  return printRustSourceFile(finalizeRustSourceStyle(createRustSourceFile(items)));
}
