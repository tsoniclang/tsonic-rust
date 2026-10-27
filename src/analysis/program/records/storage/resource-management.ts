import type { Node } from "@tsonic/tsts";
import type { RustOperationPolicyContext } from "../../../../policy/model/operation-context.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import type { RustResourceManagementFact } from "../../../../target-model/records/callables/callables-and-resources.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustOperationsProviderOptions } from "../../../operations/members/index.js";
import { selectRustResourceManagement } from "../../../control-flow/resource-management.js";
import type { RustProjectDisposerEffects, RustResourceManagementSelection } from "../../../control-flow/resource-management.js";
import { createRustRecordFamily } from "../family.js";

export interface RustResourceManagementProducer {
  readonly records: RustRecordFamily<RustResourceManagementFact>;
  select(declaration: Node, context: RustOperationPolicyContext, options: RustOperationsProviderOptions,
    projectDisposerEffects: (declaration: Node) => RustProjectDisposerEffects | undefined): RustResourceManagementSelection;
}

export function createRustResourceManagementProducer(
  assertOpen: () => void,
  inherited?: RustResourceManagementProducer["records"],
): RustResourceManagementProducer {
  const family = createRustRecordFamily<RustResourceManagementFact>({
    id: "tsonic.rust.resourceManagement", equals: closedMetadataEquals,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    select(declaration: Node, context: RustOperationPolicyContext, options: RustOperationsProviderOptions,
      projectDisposerEffects: (declaration: Node) => RustProjectDisposerEffects | undefined): RustResourceManagementSelection {
      assertOpen();
      const selection = selectRustResourceManagement(declaration, context, options, projectDisposerEffects);
      if (selection.kind === "selected") family.writer.set(declaration, selection.fact);
      return selection;
    },
  });
}
