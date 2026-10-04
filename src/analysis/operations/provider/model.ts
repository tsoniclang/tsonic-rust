import { rustSourceSemanticsModules } from "../../../source/profiles/source-modules.js";
import { tsonicCoreSourceSemanticsModules } from "@tsonic/source-core";
import { jsSourceSemanticsModules } from "@tsonic/js-source-profile";
import type { RustProjectMethodPropertyPlanRegistry } from "../../project-types/method-properties.js";
import type { RustProjectMethodDispatchPlanRegistry } from "../../project-types/method-dispatch.js";
import type { RustProjectTypePolicy } from "../../project-types/type-policy.js";
import type { RustSourceCallableAbiResolver } from "../../../policy/ownership/source-callable-abi.js";
import type { RustTargetTypeResolutionOptions } from "../../../policy/types/resolution.js";
import type { RustReceiverFieldAliasQueries } from "../../project-types/receiver-field-aliases.js";

export const sourceCallMarkerByIdentity = new Map(
  [
    ...tsonicCoreSourceSemanticsModules(),
    ...jsSourceSemanticsModules(),
    ...rustSourceSemanticsModules(),
  ].flatMap((module) =>
    module.exports
      .filter((declaration) => declaration.kind === "call-marker")
      .map((declaration) => [
        `${module.moduleSpecifier}::${declaration.exportName}`,
        declaration.marker,
      ] as const)),
);

export interface RustOperationsProviderOptions extends RustTargetTypeResolutionOptions {
  readonly receiverFieldAliases: RustReceiverFieldAliasQueries;
  readonly providerExports: readonly import("../../../providers/packages/model.js").RustProviderExportRow[];
  readonly sourceCallableAbi: RustSourceCallableAbiResolver;
  readonly projectTypes: RustProjectTypePolicy;
  readonly projectMethodDispatch: RustProjectMethodDispatchPlanRegistry;
  readonly projectMethodProperties: RustProjectMethodPropertyPlanRegistry;
}
