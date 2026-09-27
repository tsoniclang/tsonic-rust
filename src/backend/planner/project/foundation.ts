import { rustWordAttribute } from "../../target-ast/attributes.js";
import type { RustFoundation } from "../../../target-model/foundation/model.js";
import {
  createRustSourceFile,
  type RustItem,
  type RustSourceFileModel,
} from "../../target-ast/nodes.js";

export function createRustCrateRootSourceFile(
  foundation: RustFoundation,
  items: readonly RustItem[],
): RustSourceFileModel {
  return createRustSourceFile(
    foundation === "core"
      ? items
      : [{ kind: "extern-crate", name: "alloc" }, ...items],
    foundation === "std" ? [] : [rustWordAttribute("no_std")],
  );
}
