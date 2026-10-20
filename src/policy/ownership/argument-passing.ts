import type { ArgumentPassingMode } from "@tsonic/tsts";
import type { RustArgumentMode } from "../../target-model/operations/model.js";

export function rustArgumentPassingMode(mode: RustArgumentMode): Extract<ArgumentPassingMode, "by-value" | "borrow-shared" | "borrow-mut"> {
  switch (mode) {
    case "ref":
      return "borrow-shared";
    case "mut-ref":
      return "borrow-mut";
    case "value":
      return "by-value";
  }
}
