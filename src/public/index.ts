import { createRustTargetPack } from "../descriptor/rust-target-pack.js";

export { createRustTargetPack, rustTargetId } from "../descriptor/rust-target-pack.js";
export type { RustEdition, RustOutputType } from "../options/rust-target-options.js";

export function createTsonicPlugin(): import("@tsonic/target-api").TsonicTargetPlugin {
  return {
    kind: "target",
    id: "@tsonic/target-rust",
    targetId: "rust",
    createTargetPack() {
      return createRustTargetPack();
    },
  };
}
