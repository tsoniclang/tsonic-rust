import type { RustTargetConstArgument, RustTargetGenericArgument, TargetTypeRef } from "../../../target-model/types/model.js";
import { rustLifetimeKey, type RustLifetimeRef } from "../../../target-model/lifetimes/index.js";
import { snapshotClosedMetadata } from "../../../target-model/metadata/closed-data.js";
import { rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";

import type { RustNativeCaptureSelection } from "../../../target-model/records/native-captures.js";
import type { RustGenericCallableImplementation } from "../../../target-model/records/generic-callables.js";

import type { RustGenericCallableEnvironment } from "../../../target-model/records/generic-callables.js";

export function rustGenericCallableEnvironment(
  implementation: RustGenericCallableImplementation,
  capture: RustNativeCaptureSelection,
): RustGenericCallableEnvironment | undefined {
  const value = rustGenericCallableValue(implementation.carrier);
  if (capture.kind === "unresolved" || value === undefined ||
    capture.captures.length !== implementation.captures.length ||
    capture.receiverFields.length !== implementation.receiverFields.length ||
    capture.receivers.length !== implementation.receivers.length) return undefined;
  const types = new Map(implementation.substitutions);
  const lifetimes = new Map<string, RustLifetimeRef>();
  const consts = new Map<string, RustTargetConstArgument>();
  const references = capture.environment;
  if (references.hasUnnameableLifetime) return undefined;
  const arguments_: readonly RustTargetGenericArgument[] = [
    ...references.lifetimes.map(lifetime => ({ kind: "lifetime" as const, lifetime })),
    ...references.typeParameters.filter(parameter => !types.has(parameter.identity)).map(type => ({ kind: "type" as const, type })),
    ...references.constParameters.map(value => ({ kind: "const" as const, value })),
  ];
  const parameters: RustTargetGenericArgument[] = [];
  for (const [index, argument] of arguments_.entries()) {
    const identity = `${implementation.sourceFileName}:${implementation.stateName}:capture:${index}`;
    if (argument.kind === "type") {
      if (argument.type.kind !== "type-parameter") return undefined;
      const type: TargetTypeRef = Object.freeze({ kind: "type-parameter", identity, name: `CaptureType${index}` });
      types.set(argument.type.identity, type);
      parameters.push({ kind: "type", type });
    } else if (argument.kind === "lifetime") {
      const lifetime = Object.freeze({ kind: "parameter" as const, identity, name: `capture${index}` });
      lifetimes.set(rustLifetimeKey(argument.lifetime), lifetime);
      parameters.push({ kind: "lifetime", lifetime });
    } else {
      if (argument.value.kind !== "parameter") return undefined;
      const value = Object.freeze({ kind: "parameter" as const, identity, name: `CaptureConst${index}` });
      consts.set(argument.value.identity, value);
      parameters.push({ kind: "const", value });
    }
  }
  const substitute = (carrier: TargetTypeRef): TargetTypeRef => substituteRustTargetGenerics(carrier, types, lifetimes, consts);
  return Object.freeze({
    captures: Object.freeze(implementation.captures.map((value, index) => Object.freeze({ ...value,
      storageCarrier: snapshotClosedMetadata(substitute(capture.captures[index]!)) }))),
    receiverFields: Object.freeze(implementation.receiverFields.map((value, index) => Object.freeze({ ...value,
      storageCarrier: snapshotClosedMetadata(substitute(capture.receiverFields[index]!)) }))),
    receivers: Object.freeze(implementation.receivers.map((value, index) => Object.freeze({ ...value,
      storageCarrier: snapshotClosedMetadata(substitute(capture.receivers[index]!)) }))),
    parameters: snapshotClosedMetadata(parameters), arguments: snapshotClosedMetadata(arguments_), inputs: capture.inputs,
    substitutions: Object.freeze({ types, lifetimes, consts }),
  });
}
