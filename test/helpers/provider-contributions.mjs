import {
  captureTargetCapabilityContributions,
} from "../../../tsonic/packages/host/dist/target/extensions.js";

export function captureRustProviderContributions(selectedCapabilities) {
  return captureTargetCapabilityContributions({
    project: { entryPoint: "src/index.ts", targets: [{ id: "rust" }] },
    projectDirectory: "/src",
    target: { id: "rust", options: {} },
    selectedCapabilities,
    selectedSurfaces: [],
  });
}
