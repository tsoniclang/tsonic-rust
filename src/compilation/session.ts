import type {
  TargetCompilationSession,
  TargetCompilationSessionContext,
  TargetCompileInput,
  TargetSourceCompilerContributions,
  TargetSourceProfileContributions,
} from "@tsonic/target-api";
import type {
  TargetCompileResult,
  TargetRuntimeContributions,
} from "@tsonic/target-api/artifacts";
import { compileRustTarget } from "../backend/compile.js";
import {
  rustNativeSourceProfileContributions,
  rustJsSourceProfileOwnerId,
} from "../source/profiles/declarations.js";
import {
  createRustSourceSemanticsExtension,
} from "../source/extension/source-extension.js";
import {
  rustSourceSemanticsModules,
} from "../source/profiles/source-modules.js";
import {
  createRustCompilerProviderSession,
} from "../providers/compiler/session.js";
import {
  composeRustProviderSemantics,
  mergeRustProviderSemantics,
} from "../providers/packages/semantics.js";
import {
  createRustTargetConfiguration,
} from "../options/rust-target-options.js";
import { rustRuntimeCrateReference } from "./runtime-references.js";

type RustCompilationSessionState =
  | "created"
  | "profile-contributed"
  | "compiler-contributed"
  | "runtime-contributed"
  | "compiled"
  | "closed";

export function createRustCompilationSession(
  context: TargetCompilationSessionContext,
): TargetCompilationSession {
  const configuration = createRustTargetConfiguration(
    context.target,
    context.projectDirectory,
    context.paths.targetOutputRoot,
  );
  const capturedProviderSemantics = composeRustProviderSemantics(context.capabilities);
  const compilerProviderSession = createRustCompilerProviderSession({
    configuration,
  });
  const jsEnabled = context.selectedSurfaceIds.includes(rustJsSourceProfileOwnerId);
  let state: RustCompilationSessionState = "created";
  return Object.freeze({
    sourceProfileContributions(): TargetSourceProfileContributions {
      requireState(state, "created", "sourceProfileContributions");
      state = "profile-contributed";
      return jsEnabled
        ? Object.freeze({ declarations: Object.freeze([]) })
        : rustNativeSourceProfileContributions();
    },
    sourceCompilerContributions(): TargetSourceCompilerContributions {
      requireState(state, "profile-contributed", "sourceCompilerContributions");
      state = "compiler-contributed";
      return Object.freeze({
        semanticsModules: rustSourceSemanticsModules(),
        extensions: Object.freeze([
          createRustSourceSemanticsExtension(compilerProviderSession.sourceProviders),
        ]),
      });
    },
    runtimeContributions(): TargetRuntimeContributions {
      requireState(state, "compiler-contributed", "runtimeContributions");
      state = "runtime-contributed";
      return Object.freeze({
        references: Object.freeze([
          rustRuntimeCrateReference(
            context,
            "@tsonic/rust-runtime",
            "tsonic_rust_runtime",
            {
              minimumFoundation: "core",
              defaultFeatures: false,
              features: configuration.foundation === "core"
                ? Object.freeze([])
                : Object.freeze([configuration.foundation]),
            },
          ),
        ]),
      });
    },
    compile(input: TargetCompileInput): TargetCompileResult {
      requireState(state, "runtime-contributed", "compile");
      state = "compiled";
      return compileRustTarget(Object.freeze({
        input,
        configuration,
        providerSemantics: mergeRustProviderSemantics(
          capturedProviderSemantics,
          compilerProviderSession.semantics(),
        ),
        jsEnabled,
        rootPublishesLibrary: configuration.outputType === "lib",
      }));
    },
    close(): void {
      if (state === "closed") {
        return;
      }
      compilerProviderSession.close();
      state = "closed";
    },
  });
}

function requireState(
  actual: RustCompilationSessionState,
  expected: RustCompilationSessionState,
  operation: string,
): void {
  if (actual !== expected) {
    throw new Error(`Rust compilation session cannot call '${operation}' while in '${actual}' state; expected '${expected}'.`);
  }
}
