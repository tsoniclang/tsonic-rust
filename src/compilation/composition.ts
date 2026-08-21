import type {
  TargetProviderDescriptor,
  TargetSurfaceImplementation,
} from "@tsonic/target-api";
import type {
  TargetRuntimeContributionContext,
} from "@tsonic/target-api/provider";
import type {
  TargetRuntimeContributions,
} from "@tsonic/target-api/artifacts";
import { rustCompilerProviderSpecifierPrefix } from "../providers/compiler/session.js";
import { rustJsSurfaceSourceProfileContributions } from "../source/profiles/declarations.js";
import { rustRuntimeCrateReference } from "./runtime-references.js";

export const rustTargetProvider: TargetProviderDescriptor = Object.freeze({
  id: "rust-provider",
  displayName: "Rust target provider",
  moduleOwnership: Object.freeze([
    Object.freeze({ specifierPrefix: "@tsonic/rust/std/" }),
    Object.freeze({ specifierPrefix: rustCompilerProviderSpecifierPrefix }),
  ]),
});

export const rustTargetSurfaces: readonly TargetSurfaceImplementation[] = Object.freeze([
  Object.freeze({
    id: "js",
    displayName: "JavaScript surface",
    sourceProfileContributions: rustJsSurfaceSourceProfileContributions,
    runtimeContributions(context: TargetRuntimeContributionContext): TargetRuntimeContributions {
      return Object.freeze({
        references: Object.freeze([
          rustRuntimeCrateReference(context, "@tsonic/rust-js", "tsonic_rust_js"),
        ]),
      });
    },
  }),
]);
