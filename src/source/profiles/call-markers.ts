import { rustSourceSemanticsModules } from "./source-modules.js";
import { tsonicCoreSourceSemanticsModules } from "@tsonic/source-core";
import { jsSourceSemanticsModules } from "@tsonic/js-source-profile";

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
