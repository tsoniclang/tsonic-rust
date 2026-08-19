// Official plugin contract re-exports. The Rust target consumes only the
// standard @tsonic/target-api plugin types.
export type {
  TsonicPlugin,
  TsonicTargetPlugin,
} from "@tsonic/target-api";
export type {
  TsonicTargetCapabilityPlugin,
  TargetCapabilityContext,
  TargetProviderModuleOwnership,
} from "@tsonic/target-api/provider";
