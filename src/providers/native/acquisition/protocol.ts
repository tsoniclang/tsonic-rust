import type {
  RustCompilerDependency,
  RustCompilerModuleModel,
  RustCompilerProjectSnapshot,
  RustCompilerNativeRetentionQuestion,
  RustCompilerNativeRetentionBatch,
} from "../model/model.js";
import { rustCompilerProviderProtocolVersion } from "../model/model.js";
import type { RustFoundation } from "../../../target-model/foundation/model.js";

export type RustCompilerWorkerRequest =
  | {
      readonly protocolVersion: typeof rustCompilerProviderProtocolVersion;
      readonly id: string;
      readonly kind: "result-retention";
      readonly snapshot: RustCompilerProjectSnapshot;
      readonly questions: readonly RustCompilerNativeRetentionQuestion[];
      readonly targetDirectory: string;
      readonly foundation: RustFoundation;
    }
  | {
      readonly protocolVersion: typeof rustCompilerProviderProtocolVersion;
      readonly id: string;
      readonly kind: "snapshot";
      readonly manifestPath: string;
    }
  | {
      readonly protocolVersion: typeof rustCompilerProviderProtocolVersion;
      readonly id: string;
      readonly kind: "standard-snapshot";
    }
  | {
      readonly protocolVersion: typeof rustCompilerProviderProtocolVersion;
      readonly id: string;
      readonly kind: "module";
      readonly snapshot: RustCompilerProjectSnapshot;
      readonly dependency: RustCompilerDependency;
      readonly modulePath: readonly string[];
      readonly requestedExports?: readonly string[];
      readonly targetDirectory: string;
      readonly foundation: RustFoundation;
    };

export type RustCompilerWorkerResponse =
  | {
      readonly protocolVersion: typeof rustCompilerProviderProtocolVersion;
      readonly id: string;
      readonly kind: "result-retention";
      readonly batch: RustCompilerNativeRetentionBatch;
    }
  | {
      readonly protocolVersion: typeof rustCompilerProviderProtocolVersion;
      readonly id: string;
      readonly kind: "snapshot";
      readonly snapshot: RustCompilerProjectSnapshot;
    }
  | {
      readonly protocolVersion: typeof rustCompilerProviderProtocolVersion;
      readonly id: string;
      readonly kind: "module";
      readonly module: RustCompilerModuleModel;
    }
  | {
      readonly protocolVersion: typeof rustCompilerProviderProtocolVersion;
      readonly id: string;
      readonly kind: "error";
      readonly code: string;
      readonly message: string;
      readonly details: readonly string[];
    };
