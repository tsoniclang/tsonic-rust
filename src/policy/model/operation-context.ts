import type { SourceFile } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { RustSourcePolicyContext } from "./context.js";

export interface RustOperationPolicyContext extends RustSourcePolicyContext {
  readonly currentSourceFile: SourceFile;
  readonly currentSemantics: SourceFileSemantics;
  readonly extensionId: "tsonic.rust.policy";
}
