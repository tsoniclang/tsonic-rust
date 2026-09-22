import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustGenericCallableConversionMatches, type RustGenericCallableConversion } from "../../target-model/conversions/generic-callable.js";
import type { RustSourceCallableSpecializationIssue } from "./specializations.js";

export interface RustGenericCallableFlowIndex {
  readonly issues: readonly RustSourceCallableSpecializationIssue[];
  familyFor(carrier: TargetTypeRef): string | undefined;
}

export function createRustGenericCallableFlowIndex(
  flows: readonly { readonly subject: Node; readonly conversion: RustGenericCallableConversion }[],
): RustGenericCallableFlowIndex {
  const parents = new Map<string, string>();
  const issues: RustSourceCallableSpecializationIssue[] = [];
  const originKey = (carrier: TargetTypeRef): string | undefined => {
    const selected = rustGenericCallableValue(carrier);
    return selected === undefined ? undefined : closedMetadataKey(selected.origin);
  };
  const root = (key: string): string => {
    const path: string[] = [];
    let current = key;
    for (;;) {
      const parent = parents.get(current);
      if (parent === undefined || parent === current) break;
      path.push(current);
      current = parent;
    }
    for (const element of path) parents.set(element, current);
    return current;
  };
  for (const { subject, conversion } of flows) {
    const source = originKey(conversion.source);
    const target = originKey(conversion.target);
    if (source === undefined || target === undefined || !rustGenericCallableConversionMatches(conversion, conversion.source, conversion.target)) {
      issues.push({ subject, message: "A generic callable flow has contradictory selected native signatures or environments." });
      continue;
    }
    const left = root(source);
    const right = root(target);
    if (left !== right) parents.set(left < right ? right : left, left < right ? left : right);
  }
  const families = new Map([...parents.keys()].map(key => [key, root(key)]));
  return Object.freeze({ issues: Object.freeze(issues), familyFor(carrier: TargetTypeRef) {
    const key = originKey(carrier);
    return key === undefined ? undefined : families.get(key) ?? key;
  } });
}
