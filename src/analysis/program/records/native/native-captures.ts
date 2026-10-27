import type { Node } from "@tsonic/tsts";
import type { RustNativeCapturePlan, RustNativeCaptureSelection } from "../../../../target-model/records/native/native-captures.js";

export function sealRustNativeCaptures(nodes: ReadonlySet<Node>, selections: ReadonlyMap<Node, RustNativeCaptureSelection>,
  foreign: RustNativeCaptureSelection, unrequired: RustNativeCaptureSelection): RustNativeCapturePlan {
  const selected = new WeakMap(selections);
  return Object.freeze({ forDeclaration: (declaration: Node) =>
    nodes.has(declaration) ? selected.get(declaration) ?? unrequired : foreign });
}
