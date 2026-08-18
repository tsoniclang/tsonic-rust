import type { ArgumentPassingMode } from "@tsonic/tsts";
import type {
  RustArgumentMode,
} from "./keys.js";

export function rustArgumentPassingMode(mode: RustArgumentMode): ArgumentPassingMode {
  switch (mode) {
    case "ref":
      return "borrow-shared";
    case "mut-ref":
      return "borrow-mut";
    case "value":
      return "by-value";
  }
}
