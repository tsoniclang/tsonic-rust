import type { Node } from "@tsonic/tsts";
import type { RustClosureCaptureFact } from "../operations/operation-selections.js";

export type RustCaptureStorage = Pick<RustClosureCaptureFact["captures"][number], "storage" | "mutable"> & {
  readonly initialization?: "deferred";
  readonly iterationScope?: Node;
};

export interface RustCaptureStorageScope {
  readonly deferred: readonly Node[];
  readonly iterations: readonly Node[];
}
