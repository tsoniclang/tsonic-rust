import type { AstReader, Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustGenericCallableSignaturesMatch } from "../../target-model/conversions/generic-callable.js";
import { isRustBoolCarrier } from "../../target-model/types/index.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";

import type { RustTargetOperationFact } from "../../target-model/records/operations.js";
import type { RustGenericCallablePhysicalDefinition, RustGenericCallablePhysicalMember,
  RustGenericCallablePhysicalPlan } from "./generic-physical.js";
import type { RustNativeStoragePlan, RustNativeStorageSelection } from "./native-storage.js";
import type { RustSourceCallableSpecializationIssue } from "./specializations.js";
import { createRustEffectsWorkBudget, type RustEffectsWorkBudget } from "../resources/effects-work-budget.js";

export interface RustGenericCallableIdentityPair {
  readonly left: RustGenericCallablePhysicalMember;
  readonly right: RustGenericCallablePhysicalMember;
  readonly kind: "declaration" | "activation";
}

export interface RustGenericCallableIdentitySelection {
  readonly leftCarrier: TargetTypeRef;
  readonly rightCarrier: TargetTypeRef;
  readonly left: RustGenericCallablePhysicalDefinition;
  readonly right: RustGenericCallablePhysicalDefinition;
  readonly pairs: readonly RustGenericCallableIdentityPair[];
  readonly exhaustive: boolean;
}

export interface RustGenericCallableIdentityComparison extends RustGenericCallableIdentitySelection {
  readonly operation: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>;
  readonly leftNode: Node;
  readonly rightNode: Node;
}

export interface RustGenericCallableIdentityPlan {
  readonly issues: readonly RustSourceCallableSpecializationIssue[];
  forComparison(node: Node): RustGenericCallableIdentityComparison | undefined;
  forDefinition(definition: RustGenericCallablePhysicalDefinition): RustGenericCallableIdentitySelection | undefined;
}

export function selectRustGenericCallableIdentity(
  leftCarrier: TargetTypeRef, rightCarrier: TargetTypeRef, physical: RustGenericCallablePhysicalPlan,
  budget: RustEffectsWorkBudget = createRustEffectsWorkBudget(),
): RustGenericCallableIdentitySelection | undefined {
  let selected: RustGenericCallableIdentitySelection | undefined;
  return budget.run(() => { selected = selectIdentity(leftCarrier, rightCarrier, physical, budget); }) === undefined
    ? selected : undefined;
}

function selectIdentity(
  leftCarrier: TargetTypeRef, rightCarrier: TargetTypeRef, physical: RustGenericCallablePhysicalPlan,
  budget: RustEffectsWorkBudget,
  correspondence?: RustGenericCallableIdentitySelection,
): RustGenericCallableIdentitySelection | undefined {
  budget.metadata(leftCarrier);
  budget.metadata(rightCarrier);
  if (!rustGenericCallableSignaturesMatch(leftCarrier, rightCarrier)) return undefined;
  const left = physical.definitionFor(leftCarrier);
  const right = physical.definitionFor(rightCarrier);
  if (left === undefined || right === undefined || !left.identityObserved || !right.identityObserved ||
    physical.argumentsFor(leftCarrier) === undefined || physical.argumentsFor(rightCarrier) === undefined) return undefined;
  const valid = (definition: RustGenericCallablePhysicalDefinition): boolean => definition.members.length > 0 &&
    definition.members.every(member => {
      budget.step();
      const implementation = member.implementation;
      return physical.environmentFor(implementation) !== undefined && (implementation.creation === "declaration"
        ? implementation.storage === "value" && implementation.captures.length === 0 &&
          implementation.receivers.length === 0 && implementation.receiverFields.length === 0
        : implementation.creation === "activation" && implementation.storage === "shared");
    });
  if (!valid(left) || !valid(right)) return undefined;
  if (correspondence?.left === left && correspondence.right === right) return Object.freeze({
    leftCarrier, rightCarrier, left, right, pairs: correspondence.pairs, exhaustive: correspondence.exhaustive,
  });
  const candidates = new Map<Node, RustGenericCallablePhysicalMember[]>();
  for (const member of right.members) {
    budget.step();
    const existing = candidates.get(member.implementation.declaration);
    if (existing === undefined) candidates.set(member.implementation.declaration, [member]);
    else existing.push(member);
  }
  const pairs: RustGenericCallableIdentityPair[] = [];
  let exhaustive = true;
  for (const member of left.members) {
    budget.step();
    const matches = candidates.get(member.implementation.declaration) ?? [];
    if (matches.length !== right.members.length) exhaustive = false;
    for (const candidate of matches) {
      budget.step();
      if (candidate.implementation !== member.implementation) return undefined;
      pairs.push(Object.freeze({ left: member, right: candidate, kind: member.implementation.creation }));
    }
  }
  return Object.freeze({ leftCarrier, rightCarrier, left, right, pairs: Object.freeze(pairs), exhaustive });
}

export interface RustGenericCallableIdentityRequests {
  readonly operands: ReadonlyMap<Node, {
    readonly left: RustNativeStorageSelection | undefined;
    readonly right: RustNativeStorageSelection | undefined;
  }>;
  readonly budget: RustEffectsWorkBudget;
  readonly failure: ReturnType<RustEffectsWorkBudget["run"]>;
  readonly subject: Node | undefined;
}

export function prepareRustGenericCallableIdentityRequests(input: {
  readonly ast: AstReader;
  readonly nodes: readonly Node[];
  readonly records: RustProgramRecords;
  readonly nativeStorage: Pick<RustNativeStoragePlan, "valueFor">;
}): RustGenericCallableIdentityRequests {
  const operands = new Map<Node, { readonly left: RustNativeStorageSelection | undefined; readonly right: RustNativeStorageSelection | undefined }>();
  const budget = createRustEffectsWorkBudget();
  let subject: Node | undefined;
  const failure = budget.run(() => {
    for (const node of input.nodes) {
      subject = node;
      budget.step();
      const operation = input.records.targetOperation.get(node);
      if (operation?.kind !== "operator-token" || operation.operator !== "==" && operation.operator !== "!=") continue;
      const leftNode = BinaryExpression_Left(input.ast, node);
      const rightNode = BinaryExpression_Right(input.ast, node);
      if (rustGenericCallableValue(rustEffectiveValueCarrier(input.records, leftNode)) === undefined &&
        rustGenericCallableValue(rustEffectiveValueCarrier(input.records, rightNode)) === undefined) continue;
      operands.set(node, Object.freeze({ left: leftNode === undefined ? undefined : input.nativeStorage.valueFor(leftNode),
        right: rightNode === undefined ? undefined : input.nativeStorage.valueFor(rightNode) }));
    }
  });
  return Object.freeze({ operands, budget, failure, subject });
}

export function createRustGenericCallableIdentityPlan(input: {
  readonly ast: AstReader;
  readonly records: RustProgramRecords;
  readonly physical: RustGenericCallablePhysicalPlan;
  readonly requests: RustGenericCallableIdentityRequests;
}): RustGenericCallableIdentityPlan {
  const comparisons = new Map<Node, RustGenericCallableIdentityComparison>();
  const definitions = new Map<RustGenericCallablePhysicalDefinition, RustGenericCallableIdentitySelection>();
  const issues: RustSourceCallableSpecializationIssue[] = [];
  const { budget } = input.requests;
  let subject = input.requests.subject;
  const storageFor = (definition: RustGenericCallablePhysicalDefinition): RustGenericCallableIdentitySelection | undefined => {
    if (!definition.identityObserved) return undefined;
    const existing = definitions.get(definition);
    if (existing !== undefined) return existing;
    const selected = selectIdentity(definition.carrier, definition.carrier, input.physical, budget);
    if (selected !== undefined) definitions.set(definition, selected);
    return selected;
  };
  const visit = (node: Node): void => {
    const operation = input.records.targetOperation.get(node);
    if (operation?.kind !== "operator-token" || operation.operator !== "==" && operation.operator !== "!=") return;
    const leftNode = BinaryExpression_Left(input.ast, node);
    const rightNode = BinaryExpression_Right(input.ast, node);
    const leftLogical = rustEffectiveValueCarrier(input.records, leftNode);
    const rightLogical = rustEffectiveValueCarrier(input.records, rightNode);
    if (rustGenericCallableValue(leftLogical) === undefined && rustGenericCallableValue(rightLogical) === undefined) return;
    const requested = input.requests.operands.get(node);
    const leftStorage = requested?.left;
    const rightStorage = requested?.right;
    const leftDefinition = leftStorage === undefined || leftStorage.kind === "unresolved" ? undefined
      : input.physical.definitionFor(leftStorage.carrier);
    const rightDefinition = rightStorage === undefined || rightStorage.kind === "unresolved" ? undefined
      : input.physical.definitionFor(rightStorage.carrier);
    const stored = leftDefinition !== undefined && leftDefinition === rightDefinition ? storageFor(leftDefinition) : undefined;
    const selected = leftStorage === undefined || rightStorage === undefined || leftStorage.kind === "unresolved" ||
      rightStorage.kind === "unresolved" ? undefined : selectIdentity(leftStorage.carrier, rightStorage.carrier, input.physical, budget, stored);
    if (leftNode === undefined || rightNode === undefined || leftLogical === undefined || rightLogical === undefined ||
      selected === undefined || !isRustBoolCarrier(operation.resultCarrier) ||
      operation.leftConversion !== undefined || operation.rightConversion !== undefined ||
      !rustGenericCallableSignaturesMatch(leftLogical, selected.leftCarrier) ||
      !rustGenericCallableSignaturesMatch(rightLogical, selected.rightCarrier)) {
      issues.push(Object.freeze({ subject: node,
        message: "Native callable identity requires exact owned physical producers and their selected source comparison." }));
      return;
    }
    comparisons.set(node, Object.freeze({ ...selected, operation, leftNode, rightNode }));
  };
  const failure = input.requests.failure ?? budget.run(() => {
    for (const node of input.requests.operands.keys()) {
      subject = node;
      visit(node);
    }
    for (const definition of input.physical.definitions()) {
      subject = definition.members[0]?.implementation.declaration;
      budget.step();
      if (!definition.identityObserved) continue;
      const selected = storageFor(definition);
      if (selected === undefined) {
        if (subject !== undefined) issues.push(Object.freeze({ subject,
          message: "Stored native callable identity requires its exact owned producer correspondence." }));
      }
    }
  });
  if (failure !== undefined && subject !== undefined) issues.push(Object.freeze({ subject,
    message: `Native callable identity exhausted its finite analysis budget: ${failure.message}` }));
  return Object.freeze({ issues: Object.freeze(issues), forComparison: (node: Node) => comparisons.get(node),
    forDefinition: (definition: RustGenericCallablePhysicalDefinition) => definitions.get(definition) });
}
