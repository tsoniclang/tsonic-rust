import type { AstReader, Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import { rustGenericCallableSignaturesMatch } from "../../../policy/conversions/generic-callable.js";
import { isRustBoolCarrier } from "../../../target-model/types/index.js";
import { rustEffectiveValueCarrier } from "../../conversions/value-carrier-queries.js";

import type { RustTargetOperationFact } from "../../../target-model/records/operations.js";
import type { RustGenericCallablePhysicalPlan } from "../../../target-model/records/generic-callables.js";
import type { RustGenericCallablePhysicalDefinition, RustGenericCallablePhysicalMember } from "../../../target-model/records/generic-callables.js";
import type { RustNativeStoragePlan } from "../storage/native-storage.js";
import type { RustNativeStorageSelection } from "../../../target-model/records/native-storage.js";
import type { RustSourceCallableSpecializationIssue } from "../../../target-model/records/callable-issues.js";
import { createRustEffectsWorkBudget, type RustEffectsWorkBudget } from "../../errors/effects-work-budget.js";

import type { RustGenericCallableIdentityPair, RustGenericCallableIdentitySelection, RustGenericCallableIdentityComparison } from "../../../target-model/records/generic-callables.js";

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

export interface RustGenericCallableIdentitySource {
  readonly node: Node;
  readonly operation: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>;
  readonly leftNode: Node | undefined;
  readonly rightNode: Node | undefined;
  readonly leftLogical: TargetTypeRef | undefined;
  readonly rightLogical: TargetTypeRef | undefined;
}

export interface RustGenericCallableIdentitySources {
  readonly comparisons: readonly RustGenericCallableIdentitySource[];
  readonly budget: RustEffectsWorkBudget;
  readonly failure: ReturnType<RustEffectsWorkBudget["run"]>;
  readonly subject: Node | undefined;
}

interface RustGenericCallableIdentityOperandRequest {
  readonly source: RustGenericCallableIdentitySource;
  readonly left: RustNativeStorageSelection | undefined;
  readonly right: RustNativeStorageSelection | undefined;
}

export interface RustGenericCallableIdentityRequests {
  readonly operands: ReadonlyMap<Node, RustGenericCallableIdentityOperandRequest>;
  readonly budget: RustEffectsWorkBudget;
  readonly failure: ReturnType<RustEffectsWorkBudget["run"]>;
  readonly subject: Node | undefined;
}

export function prepareRustGenericCallableIdentitySources(input: {
  readonly ast: AstReader;
  readonly nodes: readonly Node[];
  readonly records: RustProgramRecords;
}): RustGenericCallableIdentitySources {
  const comparisons: RustGenericCallableIdentitySource[] = [];
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
      const leftLogical = rustEffectiveValueCarrier(input.records, leftNode);
      const rightLogical = rustEffectiveValueCarrier(input.records, rightNode);
      if (rustGenericCallableValue(leftLogical) === undefined && rustGenericCallableValue(rightLogical) === undefined) continue;
      comparisons.push(Object.freeze({ node, operation, leftNode, rightNode, leftLogical, rightLogical }));
    }
  });
  return Object.freeze({ comparisons: Object.freeze(comparisons), budget, failure, subject });
}

export function prepareRustGenericCallableIdentityRequests(input: {
  readonly sources: RustGenericCallableIdentitySources;
  readonly nativeStorage: Pick<RustNativeStoragePlan, "valueFor">;
}): RustGenericCallableIdentityRequests {
  if (input.sources === undefined) failTargetAnalysisInvariant("tsonic-rust", "Native callable identity requires its exact selected source comparison inventory.");
  const operands = new Map<Node, RustGenericCallableIdentityOperandRequest>();
  const { comparisons, budget, failure, subject } = input.sources;
  if (failure === undefined) for (const source of comparisons) operands.set(source.node, Object.freeze({ source,
    left: source.leftNode === undefined ? undefined : input.nativeStorage.valueFor(source.leftNode),
    right: source.rightNode === undefined ? undefined : input.nativeStorage.valueFor(source.rightNode) }));
  return Object.freeze({ operands, budget, failure, subject });
}

export function createRustGenericCallableIdentityPlan(input: {
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
  const visit = (node: Node, requested: RustGenericCallableIdentityOperandRequest): void => {
    const { operation, leftNode, rightNode, leftLogical, rightLogical } = requested.source;
    const leftStorage = requested.left;
    const rightStorage = requested.right;
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
    for (const [node, requested] of input.requests.operands) {
      subject = node;
      visit(node, requested);
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
  return sealRustGenericCallableIdentityPlan(comparisons, definitions, issues);
}

import type { RustGenericCallableIdentityPlan } from "../../../target-model/records/generic-callable-identity.js";
import { sealRustGenericCallableIdentityPlan } from "../../program/records/generic-callable-identity.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
