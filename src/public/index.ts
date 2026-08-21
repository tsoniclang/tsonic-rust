import { createRustTargetPack } from "../descriptor/rust-target-pack.js";

export { createRustTargetPack } from "../descriptor/rust-target-pack.js";
export { rustTargetId } from "../target-model/identities/target.js";
export type { RustEdition, RustOutputType } from "../target-model/project/model.js";

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
