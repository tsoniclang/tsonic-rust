import type {
  TargetPack,
  TargetToolchain,
  TargetToolchainContext,
} from "@tsonic/target-api";
import {
  createRustCompilationSession,
  rustTargetProvider,
  rustTargetSurfaces,
} from "../compilation/index.js";
import { rustTargetId } from "../target-model/identities/target.js";
import { createCargoToolchain } from "../toolchain/cargo-toolchain.js";

export function createRustTargetPack(): TargetPack {
  return Object.freeze({
    id: rustTargetId,
    displayName: "Rust",
    provider: rustTargetProvider,
    surfaces: rustTargetSurfaces,
    createCompilationSession: createRustCompilationSession,
    createToolchain(context: TargetToolchainContext): TargetToolchain {
      return createCargoToolchain(context);
    },
  });
}
