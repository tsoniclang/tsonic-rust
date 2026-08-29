import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import {
  rustFutureValueFactKey,
  rustResourceManagementFactKey,
  rustTargetOperationFactKey,
} from "../facts/keys.js";
import type { RustBinaryEpiloguePlan } from "../runtime/index.js";

export function analyzeRustProviderErrorCarriers(
  ast: AstReader,
  sourceFiles: readonly SourceFile[],
  facts: RustPlanQueries,
  binaryEpilogues: readonly RustBinaryEpiloguePlan[],
): readonly TargetTypeRef[] {
  const carriers: TargetTypeRef[] = [];
  const add = (carrier: TargetTypeRef | undefined): void => {
    if (carrier !== undefined && !carriers.some((candidate) =>
      rustTargetTypeRefEquals(candidate, carrier))) {
      carriers.push(carrier);
    }
  };
  const visit = (node: Node): void => {
    const operation = facts.getFact(node, rustTargetOperationFactKey);
    if (operation?.kind === "provider-operation" &&
      operation.abi.effects.errorBoundary === "provider-native") {
      add(operation.abi.effects.errorCarrier);
    }
    if (operation?.kind === "provider-operation" &&
      operation.abi.target.form === "source-module-construction" &&
      operation.abi.target.bootstrap.errorBoundary === "provider-native") {
      add(operation.abi.target.bootstrap.errorCarrier);
    }
    const future = facts.getFact(node, rustFutureValueFactKey);
    if (future?.errorBoundary === "provider-native") {
      add(future.errorCarrier);
    }
    const resource = facts.getFact(node, rustResourceManagementFactKey);
    if (resource?.disposal.errorBoundary === "provider-native") {
      add(resource.disposal.errorCarrier);
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  for (const sourceFile of sourceFiles) {
    visit(sourceFile);
  }
  for (const epilogue of binaryEpilogues) {
    if (epilogue.errorBoundary === "provider-native") {
      add(epilogue.errorCarrier);
    }
  }
  return Object.freeze(carriers);
}
