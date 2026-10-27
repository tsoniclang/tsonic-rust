import type { Node } from "@tsonic/tsts";
import type { RustNativeStorageSelection } from "../../../../target-model/records/native/native-storage.js";

const unavailable: RustNativeStorageSelection = Object.freeze({ kind: "unresolved",
  reason: "Native parameter storage requires its exact owned formal parameter." });

export function sealRustNativeParameterStorage(parameters: ReadonlyMap<Node, RustNativeStorageSelection>) {
  const selected = new WeakMap(parameters);
  return Object.freeze({ get: (parameter: Node): RustNativeStorageSelection => selected.get(parameter) ?? unavailable });
}
