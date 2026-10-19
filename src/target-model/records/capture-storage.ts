import type { Node } from "@tsonic/tsts";

export interface RustCaptureStorageScope {
  readonly deferred: readonly Node[];
  readonly iterations: readonly Node[];
}
