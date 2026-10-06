import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import {
  rustFutureValueFactKey,
  rustResourceManagementFactKey,
  rustTargetOperationFactKey,
} from "../facts/keys.js";
import type { RustBinaryHookPlan } from "../runtime/index.js";
import type { RustProviderBinaryHookRow, RustProviderOperationRow } from "../../providers/packages/model.js";
import type { RustProgramErrorRoute } from "../../target-model/conversions/program-error.js";

function appendUniqueCarrier(carriers: TargetTypeRef[], carrier: TargetTypeRef | undefined): void {
  if (carrier !== undefined && !carriers.some(candidate => rustTargetTypeRefEquals(candidate, carrier))) carriers.push(carrier);
}

export function collectRustDeclaredProviderErrorCarriers(
  rows: readonly RustProviderOperationRow[],
  binaryHooks: readonly RustProviderBinaryHookRow[],
): readonly TargetTypeRef[] {
  const carriers: TargetTypeRef[] = [];
  for (const row of rows) {
    for (const carrier of row.nativeErrorCarriers ?? []) appendUniqueCarrier(carriers, carrier);
    if (row.isFallible === true && row.errorBoundary === "provider-native") appendUniqueCarrier(carriers, row.errorCarrier);
    if (row.target.form === "source-module-construction" && row.target.bootstrap.errorBoundary === "provider-native") {
      appendUniqueCarrier(carriers, row.target.bootstrap.errorCarrier);
    }
  }
  for (const hook of binaryHooks) {
    if (hook.isFallible === true && hook.errorBoundary === "provider-native") appendUniqueCarrier(carriers, hook.errorCarrier);
  }
  return Object.freeze(carriers);
}

export function analyzeRustProviderErrorCarriers(
  ast: AstReader,
  sourceFiles: readonly SourceFile[],
  facts: RustPlanQueries,
  binaryHooks: readonly RustBinaryHookPlan[],
): readonly TargetTypeRef[] {
  const carriers: TargetTypeRef[] = [];
  const add = (carrier: TargetTypeRef | undefined): void => {
    appendUniqueCarrier(carriers, carrier);
  };
  const addRoute = (carrier: TargetTypeRef, route: RustProgramErrorRoute): void => {
    if (route.kind === "union") {
      for (const arm of route.arms) addRoute(arm.carrier, arm.route);
    } else if (route.kind === "runtime" && route.boundary === "provider-native") add(carrier);
  };
  const visit = (node: Node): void => {
    const operation = facts.getFact(node, rustTargetOperationFactKey);
    if (operation?.kind === "provider-operation") {
      for (const carrier of operation.abi.effects.nativeErrorCarriers ?? []) add(carrier);
    }
    if (operation?.kind === "throw-op" && operation.error.kind === "conversion") {
      addRoute(operation.error.conversion.source, operation.error.conversion.route);
    }
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
  for (const epilogue of binaryHooks) {
    if (epilogue.errorBoundary === "provider-native") {
      add(epilogue.errorCarrier);
    }
  }
  return Object.freeze(carriers);
}
