import type { AstReader, Node } from "@tsonic/tsts";
import { sourceBindingCapturedBeforeInitialization, sourceBindingIterationScope } from "@tsonic/target-api/source";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import type { RustBindingStorageFact } from "../../target-model/records/operations/operation-selections.js";

export function selectRustBindingLocationStorage(
  declaration: Node,
  ast: AstReader,
  navigation: Pick<SourceProgramNavigation, "declarationUses">,
): Pick<RustBindingStorageFact, "initialization" | "iterationScope"> & { readonly storage: "location" } {
  const deferred = sourceBindingCapturedBeforeInitialization(declaration, ast, navigation);
  const iterationScope = sourceBindingIterationScope(declaration, ast);
  return Object.freeze({ storage: "location",
    ...(deferred ? { initialization: "deferred" as const } : {}),
    ...(iterationScope === undefined ? {} : { iterationScope }),
  });
}
