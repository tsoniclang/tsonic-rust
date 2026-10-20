import { createRustTargetPack } from "./target-pack.js";
import { createRustStarterProject } from "./starter-project.js";

export function createTsonicPlugin(): import("@tsonic/target-api").TsonicTargetPlugin {
  return {
    kind: "target",
    id: "@tsonic/target-rust",
    targetId: "rust",
    createTargetPack() {
      return createRustTargetPack();
    },
    createStarterProject: createRustStarterProject,
  };
}
