import type { AstReader, Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right, BinaryExpression_OperatorToken, Node_Expression,
  IfStatement_ThenStatement, IfStatement_ElseStatement, IterationStatement_Statement,
  DoStatement_Statement, TryStatement_TryBlock, TryStatement_CatchClause, TryStatement_FinallyBlock,
  CatchClause_Block, SwitchStatement_CaseBlock, CaseBlock_Clauses, CaseOrDefaultClause_Statements,
  CaseOrDefaultClause_Expression, LabeledStatement_Statement,
  ConditionalExpression_Condition, ConditionalExpression_WhenTrue,
  ConditionalExpression_WhenFalse, ForStatement_Initializer, ForStatement_Condition,
  ForStatement_Incrementor, sourceControlTransferTarget, sourceNodeIsIteration } from "@tsonic/target-api/source";
import { rustConstructionFallthrough as fallthrough, rustConstructionFlowStates, rustConstructionFinalizeFlow,
  type RustConstructionState as ConstructionState, type RustConstructionFlow as ConstructionFlow,
  type RustConstructionTransfer } from "./construction-flow.js";
import type { RustConstructionIssue } from "./construction-plan.js";
import type { RustProjectTypeDefinition } from "./type-policy.js";

export interface RustConstructionExpression {
  readonly node: Node;
  readonly kind: "receiver" | "field" | "capture";
  readonly declaration?: Node;
  readonly receiver?: Node;
}

export interface RustConstructionPoint {
  readonly node: Node;
  readonly initializedFields: readonly Node[];
  readonly possiblyInitializedFields: readonly Node[];
  readonly published: boolean;
  readonly publishBefore: boolean;
  readonly publishAfter: boolean;
  readonly publishMissingElse: boolean;
}

export interface RustConstructionPointQueries {
  readonly expressions: readonly RustConstructionExpression[];
  readonly completesNormally: boolean;
  layerCompletes(definition: RustProjectTypeDefinition): boolean;
  layerHasEarlyReturn(definition: RustProjectTypeDefinition): boolean;
  mutatesUnpublishedField(declaration: Node): boolean;
  pointFor(node: Node): RustConstructionPoint | undefined;
  expressionsWithin(node: Node): readonly RustConstructionExpression[];
}

export interface RustConstructionReadinessField {
  readonly declaration: Node;
  readonly initializer?: Node;
  readonly absenceDefault: boolean;
  readonly externallyInitialized: boolean;
}

export interface RustConstructionReadinessInput {
  readonly ast: AstReader;
  readonly definition: RustProjectTypeDefinition;
  readonly layers: readonly {
    readonly definition: RustProjectTypeDefinition;
    readonly constructor?: Node;
    readonly fields: readonly RustConstructionReadinessField[];
    readonly statements: readonly Node[];
  }[];
  readonly fields: readonly RustConstructionReadinessField[];
  selectedField(node: Node): { readonly declaration: Node; readonly accessMode: "read" | "write" | "read-write" | "delete" } | undefined;
  guardResult(node: Node): boolean | undefined;
  unreachable(node: Node): boolean;
  mayThrow(node: Node): boolean;
}

export function analyzeRustConstructionReadiness(input: RustConstructionReadinessInput): RustConstructionPointQueries & {
  readonly issues: readonly RustConstructionIssue[];
  readonly publishesReceiver: boolean;
  readonly mutatesPublishedFields: boolean;
  readonly deferredCaptureFields: readonly Node[];
  readonly publishedFieldWrites: readonly Node[];
} {
  const deferredCaptureFields = new Set<Node>();
  const publishedFieldWrites = new Set<Node>();
  const unpublishedFieldWrites = new Set<Node>();
  const points = new Map<Node, RustConstructionPoint>();
  const expressions = new Map<Node, readonly RustConstructionExpression[]>();
  const issues: RustConstructionIssue[] = [];
  const declarations = new Set(input.fields.map(field => field.declaration));
  const layerCompletion = new Map<RustProjectTypeDefinition, boolean>();
  const layerEarlyReturn = new Set<RustProjectTypeDefinition>();
  let earlyReturns = 0;
  let visited = 0;
  let publishesReceiver = false;
  let mutatesPublishedFields = false;
  let exceptionalStates: ConstructionState[] | undefined;
  const issue = (node: Node, reason: string): void => {
    if (!issues.some(existing => existing.node === node && existing.reason === reason))
      issues.push(Object.freeze({ node, reason }));
  };
  const account = (node: Node, depth: number): boolean => {
    visited += 1;
    if (visited <= 262_144 && depth <= 256) return true;
    issue(node, "Native constructor readiness exceeds its finite node/depth budget.");
    return false;
  };
  const ready = (state: ConstructionState): boolean => state.initialized.size === declarations.size;
  const selectedField = (node: Node): Node | undefined => {
    const selected = input.selectedField(node);
    return selected !== undefined && declarations.has(selected.declaration) ? selected.declaration : undefined;
  };
  const receiverIsThis = (node: Node): boolean => {
    let receiver = Node_Expression(input.ast, node);
    for (let depth = 0; receiver !== undefined && depth < 256 &&
      (input.ast.is.IsParenthesizedExpression(receiver) || input.ast.is.IsAsExpression(receiver) ||
        input.ast.is.IsSatisfiesExpression(receiver) || input.ast.is.IsNonNullExpression(receiver) || input.ast.is.IsTypeAssertion(receiver)); depth += 1)
      receiver = Node_Expression(input.ast, receiver);
    return receiver !== undefined && (input.ast.kindName(receiver) === "KindThisExpression" ||
      input.ast.kindName(receiver) === "KindThisKeyword");
  };
  const selectedExpressions = (root: Node): readonly RustConstructionExpression[] => {
    const existing = expressions.get(root);
    if (existing !== undefined) return existing;
    const found: RustConstructionExpression[] = [];
    const visit = (node: Node, depth: number, captured = false): void => {
      if (!account(node, depth)) return;
      const kind = input.ast.kindName(node);
      if (node !== root && (input.ast.is.IsFunctionDeclaration(node) || input.ast.is.IsFunctionExpression(node) ||
        input.ast.is.IsClassDeclaration(node) || input.ast.is.IsClassExpression(node))) return;
      if ((input.ast.is.IsPropertyAccessExpression(node) || input.ast.is.IsElementAccessExpression(node)) &&
        receiverIsThis(node)) {
        const declaration = selectedField(node);
        if (declaration !== undefined) {
          found.push(Object.freeze({ node, declaration, receiver: Node_Expression(input.ast, node),
            kind: captured ? "capture" : "field" }));
          return;
        }
      }
      if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
        found.push(Object.freeze({ node, kind: "receiver" }));
        return;
      }
      input.ast.forEachChild(node, child => { if (child !== undefined)
        visit(child, depth + 1, captured || input.ast.is.IsArrowFunction(node)); });
    };
    visit(root, 0);
    const result = Object.freeze(found);
    expressions.set(root, result);
    return result;
  };
  const record = (node: Node, state: ConstructionState, publishBefore = false, publishAfter = false): void => {
    if (node !== input.definition.declaration) selectedExpressions(node);
    points.set(node, Object.freeze({ node, initializedFields: Object.freeze([...state.initialized]),
      possiblyInitializedFields: Object.freeze([...state.possiblyInitialized]),
      published: state.published, publishBefore, publishAfter, publishMissingElse: false }));
  };
  const enter = (node: Node, state: ConstructionState, roots: readonly Node[]): ConstructionState => {
    for (const root of roots) for (const capture of selectedExpressions(root)) {
      if (capture.kind === "capture" && capture.declaration !== undefined && !state.initialized.has(capture.declaration))
        deferredCaptureFields.add(capture.declaration);
    }
    const requiresReceiver = roots.some(root => selectedExpressions(root).some(expression => expression.kind === "receiver"));
    let selected = state;
    if (!state.published && requiresReceiver) {
      if (ready(state)) {
        publishesReceiver = true;
        selected = Object.freeze({ ...state, published: true });
      } else issue(node, "A native receiver cannot be published before every physical field has been definitely initialized.");
    }
    record(node, selected, selected !== state);
    return selected;
  };
  const expression = (node: Node, state: ConstructionState, depth: number): ConstructionState => {
    if (!account(node, depth)) return state;
    if (input.ast.is.IsConditionalExpression(node)) {
      const condition = ConditionalExpression_Condition(input.ast, node);
      const consequent = ConditionalExpression_WhenTrue(input.ast, node);
      const alternative = ConditionalExpression_WhenFalse(input.ast, node);
      const afterCondition = condition === undefined ? state : expression(condition, state, depth + 1);
      const guard = condition === undefined ? undefined : input.guardResult(condition);
      if (guard !== undefined) {
        const selected = guard ? consequent : alternative;
        return selected === undefined ? afterCondition : expression(selected, afterCondition, depth + 1);
      }
      return intersection([consequent === undefined ? afterCondition : expression(consequent, afterCondition, depth + 1),
        alternative === undefined ? afterCondition : expression(alternative, afterCondition, depth + 1)]);
    }
    if (input.ast.is.IsBinaryExpression(node)) {
      const left = BinaryExpression_Left(input.ast, node);
      const right = BinaryExpression_Right(input.ast, node);
      const operator = BinaryExpression_OperatorToken(input.ast, node);
      if (left !== undefined && right !== undefined && operator !== undefined) {
        const operation = input.ast.kindName(operator);
        const declaration = receiverIsThis(left) ? selectedField(left) : undefined;
        if (declaration !== undefined && operation === "KindEqualsToken") {
          const afterValue = expression(right, state, depth + 1);
          record(left, afterValue);
          if (afterValue.possiblyInitialized.has(declaration) && !afterValue.initialized.has(declaration))
            deferredCaptureFields.add(declaration);
          if (afterValue.published) { mutatesPublishedFields = true; publishedFieldWrites.add(declaration); }
          else if (afterValue.possiblyInitialized.has(declaration)) unpublishedFieldWrites.add(declaration);
          return Object.freeze({ ...afterValue, initialized: new Set([...afterValue.initialized, declaration]),
            possiblyInitialized: new Set([...afterValue.possiblyInitialized, declaration]) });
        }
        if (operation === "KindAmpersandAmpersandToken" || operation === "KindBarBarToken" ||
          operation === "KindQuestionQuestionToken") {
          const afterLeft = expression(left, state, depth + 1);
          const guard = operation === "KindQuestionQuestionToken" ? undefined : input.guardResult(left);
          if (guard !== undefined) return guard === (operation === "KindAmpersandAmpersandToken")
            ? expression(right, afterLeft, depth + 1) : afterLeft;
          const afterRight = expression(right, afterLeft, depth + 1);
          return intersection([afterLeft, afterRight]);
        }
      }
    }
    if ((input.ast.is.IsPropertyAccessExpression(node) || input.ast.is.IsElementAccessExpression(node)) && receiverIsThis(node)) {
      const declaration = selectedField(node);
      if (declaration !== undefined) {
        record(node, state);
        const field = input.selectedField(node);
        if (field !== undefined && field.accessMode !== "write" && !state.initialized.has(declaration))
          issue(node, "A native constructor field read has no dominating exact initialization.");
        if (field !== undefined && field.accessMode !== "read" && state.published) {
          mutatesPublishedFields = true; publishedFieldWrites.add(declaration);
        }
        if (field !== undefined && field.accessMode !== "read" && !state.published &&
          state.possiblyInitialized.has(declaration)) unpublishedFieldWrites.add(declaration);
        return state;
      }
    }
    if (input.ast.is.IsArrowFunction(node) || input.ast.is.IsFunctionExpression(node) ||
      input.ast.is.IsFunctionDeclaration(node) || input.ast.is.IsClassDeclaration(node) || input.ast.is.IsClassExpression(node)) return state;
    let next = state;
    input.ast.forEachChild(node, child => { if (child !== undefined) next = expression(child, next, depth + 1); });
    if (input.mayThrow(node)) exceptionalStates?.push(next);
    return next;
  };
  const sequence = (nodes: readonly (Node | undefined)[], initial: ConstructionState, depth: number): ConstructionFlow => {
    let normal: ConstructionState | undefined = initial;
    const returned: ConstructionState[] = [];
    const thrown: ConstructionState[] = [];
    const breaks: RustConstructionTransfer[] = [];
    const continues: RustConstructionTransfer[] = [];
    for (const node of nodes) {
      if (node === undefined) { issue(input.definition.declaration, "Constructor control-flow contains an undefined source node."); continue; }
      if (normal === undefined) break;
      const next = statement(node, normal, depth + 1);
      normal = next.normal;
      returned.push(...next.returned); thrown.push(...next.thrown); breaks.push(...next.breaks); continues.push(...next.continues);
    }
    return { normal, returned, thrown, breaks, continues };
  };
  const join = (node: Node, branches: readonly { readonly node?: Node; readonly flow: ConstructionFlow }[]): ConstructionFlow => {
    const normal = branches.flatMap(branch => branch.flow.normal === undefined ? [] : [branch]);
    const published = normal.some(branch => branch.flow.normal!.published);
    if (published && normal.some(branch => !branch.flow.normal!.published)) {
      for (const branch of normal) {
        const state = branch.flow.normal!;
        if (state.published) continue;
        if (!ready(state)) {
          issue(node, "Native receiver publication must have one definitely initialized storage owner on every continuing branch.");
          continue;
        }
        if (branch.node === undefined && input.ast.kindName(node) === "KindIfStatement") {
          const previous = points.get(node);
          if (previous !== undefined) points.set(node, Object.freeze({ ...previous, publishMissingElse: true }));
          continue;
        }
        if (branch.node === undefined) {
          issue(node, "Native receiver publication has no exact continuing source region.");
          continue;
        }
        const previous = points.get(branch.node);
        if (previous !== undefined) points.set(branch.node, Object.freeze({ ...previous, publishAfter: true }));
      }
    }
    return { normal: normal.length === 0 ? undefined : intersection(normal.map(branch =>
      Object.freeze({ ...branch.flow.normal!, published }))),
      returned: branches.flatMap(branch => branch.flow.returned), thrown: branches.flatMap(branch => branch.flow.thrown),
      breaks: branches.flatMap(branch => branch.flow.breaks),
      continues: branches.flatMap(branch => branch.flow.continues) };
  };
  const statement = (node: Node, initial: ConstructionState, depth: number): ConstructionFlow => {
    if (!account(node, depth) || input.unreachable(node)) return fallthrough(initial);
    const kind = input.ast.kindName(node);
    if (kind === "KindBlock") {
      record(node, initial);
      return sequence(input.ast.statements(node), initial, depth);
    }
    if (kind === "KindIfStatement") {
      const condition = Node_Expression(input.ast, node);
      const thenNode = IfStatement_ThenStatement(input.ast, node);
      const elseNode = IfStatement_ElseStatement(input.ast, node);
      let state = enter(node, initial, condition === undefined ? [] : [condition]);
      if (condition !== undefined) state = expression(condition, state, depth + 1);
      const guard = condition === undefined ? undefined : input.guardResult(condition);
      if (guard !== undefined) {
        const selected = guard ? thenNode : elseNode;
        return selected === undefined ? fallthrough(state) : statement(selected, state, depth + 1);
      }
      return join(node, [
        { node: thenNode, flow: thenNode === undefined ? fallthrough(state) : statement(thenNode, state, depth + 1) },
        { node: elseNode, flow: elseNode === undefined ? fallthrough(state) : statement(elseNode, state, depth + 1) },
      ]);
    }
    if (sourceNodeIsIteration(input.ast, node)) {
      const initializer = kind === "KindForStatement" ? ForStatement_Initializer(input.ast, node) : undefined;
      const condition = kind === "KindForStatement" ? ForStatement_Condition(input.ast, node) : Node_Expression(input.ast, node);
      const incrementor = kind === "KindForStatement" ? ForStatement_Incrementor(input.ast, node) : undefined;
      const header = [initializer, ...(kind === "KindDoStatement" ? [] : [condition])]
        .filter((value): value is Node => value !== undefined);
      let state = enter(node, initial, ready(initial) ? [node] : header);
      for (const value of header) state = expression(value, state, depth + 1);
      const guard = condition === undefined ? kind === "KindForStatement" ? true : undefined : input.guardResult(condition);
      if (kind !== "KindDoStatement" && guard === false) return fallthrough(state);
      const body = kind === "KindDoStatement" ? DoStatement_Statement(input.ast, node) : IterationStatement_Statement(input.ast, node);
      const repeatedWrites = (body === undefined ? [] : selectedExpressions(body)).filter(entry => entry.kind === "field" &&
        entry.declaration !== undefined && input.selectedField(entry.node)?.accessMode !== "read").map(entry => entry.declaration!);
      state = Object.freeze({ ...state, possiblyInitialized: new Set([...state.possiblyInitialized, ...repeatedWrites]) });
      const flow = body === undefined ? fallthrough(state) : statement(body, state, depth + 1);
      const continuing = [...(flow.normal === undefined ? [] : [flow.normal]),
        ...flow.continues.filter(transfer => transfer.target === node).map(transfer => transfer.state)];
      const breaks = flow.breaks.filter(transfer => transfer.target === node).map(transfer => transfer.state);
      if (!state.published && [...continuing, ...breaks].some(result => result.published))
        issue(node, "A repeated native constructor region cannot move field-local storage into its root more than once.");
      const repeated = continuing.map(entry => {
        let next = entry;
        if (incrementor !== undefined) next = expression(incrementor, next, depth + 1);
        if (kind === "KindDoStatement" && condition !== undefined) next = expression(condition, next, depth + 1);
        return next;
      });
      const exits = [...breaks, ...(guard === true ? [] : kind === "KindDoStatement" ? repeated : [state])];
      return { normal: exits.length === 0 ? undefined : intersection(exits), returned: flow.returned, thrown: flow.thrown,
        breaks: flow.breaks.filter(transfer => transfer.target !== node),
        continues: flow.continues.filter(transfer => transfer.target !== node) };
    }
    if (kind === "KindTryStatement") {
      const state = ready(initial) ? enter(node, initial, [node]) : enter(node, initial, []);
      const tryBlock = TryStatement_TryBlock(input.ast, node);
      const catchBlock = CatchClause_Block(input.ast, TryStatement_CatchClause(input.ast, node));
      const finalBlock = TryStatement_FinallyBlock(input.ast, node);
      const outerExceptions = exceptionalStates;
      const localExceptions: ConstructionState[] = [];
      exceptionalStates = localExceptions;
      const attempted = tryBlock === undefined ? fallthrough(state) : statement(tryBlock, state, depth + 1);
      exceptionalStates = outerExceptions;
      const exceptions = [...attempted.thrown, ...localExceptions];
      const branches: { readonly node?: Node; readonly flow: ConstructionFlow }[] = [
        { node: tryBlock, flow: { ...attempted, thrown: catchBlock === undefined ? exceptions : [] } }];
      if (catchBlock !== undefined && exceptions.length !== 0) branches.push({ node: catchBlock,
        flow: statement(catchBlock, intersection(exceptions), depth + 1) });
      const joined = join(node, branches);
      if (finalBlock === undefined) { outerExceptions?.push(...joined.thrown); return joined; }
      const entries = rustConstructionFlowStates(joined);
      if (entries.length === 0) return joined;
      if (entries.some(entry => entry.published) && entries.some(entry => !entry.published))
        issue(node, "Native cleanup requires one consistent physical storage owner on every incoming completion.");
      const finalized = statement(finalBlock, intersection(entries), depth + 1);
      const result = rustConstructionFinalizeFlow(joined, finalized);
      outerExceptions?.push(...result.thrown);
      return result;
    }
    if (kind === "KindSwitchStatement") {
      const discriminant = Node_Expression(input.ast, node);
      let state = ready(initial) ? enter(node, initial, [node])
        : enter(node, initial, discriminant === undefined ? [] : [discriminant]);
      if (discriminant !== undefined) state = expression(discriminant, state, depth + 1);
      const clauses = CaseBlock_Clauses(input.ast, SwitchStatement_CaseBlock(input.ast, node));
      const branches: { readonly node?: Node; readonly flow: ConstructionFlow }[] = [];
      const matched = new Map<Node, ConstructionState>();
      for (const clause of clauses ?? []) {
        if (clause === undefined) { issue(node, "Constructor switch contains an undefined clause."); continue; }
        const clauseExpression = CaseOrDefaultClause_Expression(input.ast, clause);
        if (clauseExpression !== undefined) {
          state = enter(clauseExpression, state, [clauseExpression]);
          state = expression(clauseExpression, state, depth + 1);
          matched.set(clause, state);
        }
      }
      let previous: ConstructionState | undefined;
      let hasDefault = false;
      for (const clause of clauses ?? []) {
        if (clause === undefined) continue;
        hasDefault ||= input.ast.kindName(clause) === "KindDefaultClause";
        const selected = matched.get(clause) ?? state;
        const entry = previous === undefined ? selected : intersection([selected, previous]);
        record(clause, entry);
        const flow = sequence(CaseOrDefaultClause_Statements(input.ast, clause) ?? [], entry, depth + 1);
        previous = flow.normal;
        const exits = flow.breaks.filter(transfer => transfer.target === node);
        branches.push({ node: clause, flow: { normal: exits.length === 0 ? undefined : intersection(exits.map(exit => exit.state)),
          returned: flow.returned, thrown: flow.thrown, breaks: flow.breaks.filter(transfer => transfer.target !== node),
          continues: flow.continues } });
      }
      if (previous !== undefined) branches.push({ flow: fallthrough(previous) });
      if (!hasDefault) branches.push({ flow: fallthrough(state) });
      return join(node, branches);
    }
    if (kind === "KindLabeledStatement") {
      record(node, initial);
      const body = LabeledStatement_Statement(input.ast, node);
      const flow = body === undefined ? fallthrough(initial) : statement(body, initial, depth + 1);
      const exits = [...(flow.normal === undefined ? [] : [flow.normal]),
        ...flow.breaks.filter(transfer => transfer.target === node).map(transfer => transfer.state)];
      return { ...flow, normal: exits.length === 0 ? undefined : intersection(exits),
        breaks: flow.breaks.filter(transfer => transfer.target !== node) };
    }
    const state = enter(node, initial, [node]);
    const after = expression(node, state, depth + 1);
    if (kind === "KindReturnStatement") {
      if (Node_Expression(input.ast, node) === undefined) earlyReturns += 1;
      return { ...fallthrough(), returned: [after] };
    }
    if (kind === "KindThrowStatement") return { ...fallthrough(), thrown: [after] };
    if (kind === "KindBreakStatement" || kind === "KindContinueStatement") {
      const target = sourceControlTransferTarget(input.ast, node);
      if (target === undefined) issue(node, "Native construction transfer has no exact lexical control target.");
      return { ...fallthrough(), [kind === "KindBreakStatement" ? "breaks" : "continues"]: [{ target, state: after }] };
    }
    return fallthrough(after);
  };
  const absenceFields = new Set(input.fields.filter(field => field.absenceDefault).map(field => field.declaration));
  let state: ConstructionState = Object.freeze({ initialized: absenceFields, possiblyInitialized: absenceFields, published: false });
  let completesNormally = true;
  for (const layer of input.layers) {
    const previousReturns = earlyReturns;
    for (const field of layer.fields) {
      if (field.initializer !== undefined) {
        state = enter(field.initializer, state, [field.initializer]);
        state = expression(field.initializer, state, 0);
      } else record(field.declaration, state);
      if (field.initializer !== undefined || field.absenceDefault || field.externallyInitialized)
        state = Object.freeze({ ...state, initialized: new Set([...state.initialized, field.declaration]),
          possiblyInitialized: new Set([...state.possiblyInitialized, field.declaration]) });
    }
    const flow = sequence(layer.statements, state, 0);
    if (earlyReturns !== previousReturns) layerEarlyReturn.add(layer.definition);
    const continuing = [flow.normal, ...flow.returned].filter((result): result is ConstructionState => result !== undefined);
    layerCompletion.set(layer.definition, continuing.length !== 0);
    completesNormally = continuing.length !== 0;
    if (continuing.length === 0) break;
    if (continuing.length !== 0) state = intersection(continuing);
    const last = layer === input.layers[input.layers.length - 1];
    const required = last ? input.fields : layer.fields;
    if (continuing.some(result => required.some(field => !result.initialized.has(field.declaration))))
      issue(layer.constructor ?? layer.definition.declaration, "A successful native constructor path leaves required physical storage uninitialized.");
  }
  record(input.definition.declaration, state);
  const indexedExpressions = new Map<Node, RustConstructionExpression>();
  for (const entries of expressions.values()) for (const entry of entries) indexedExpressions.set(entry.node, entry);
  return Object.freeze({ issues: Object.freeze(issues), publishesReceiver, mutatesPublishedFields, completesNormally,
    deferredCaptureFields: Object.freeze([...deferredCaptureFields]),
    publishedFieldWrites: Object.freeze([...publishedFieldWrites]),
    layerCompletes: (definition: RustProjectTypeDefinition) => layerCompletion.get(definition) === true,
    layerHasEarlyReturn: (definition: RustProjectTypeDefinition) => layerEarlyReturn.has(definition),
    mutatesUnpublishedField: (declaration: Node) => unpublishedFieldWrites.has(declaration),
    expressions: Object.freeze([...indexedExpressions.values()]),
    pointFor: (node: Node) => points.get(node),
    expressionsWithin: (node: Node) => expressions.get(node) ?? emptyExpressions });
}

const emptyExpressions: readonly RustConstructionExpression[] = Object.freeze([]);

function intersection(states: readonly ConstructionState[]): ConstructionState {
  const first = states[0];
  return Object.freeze({ initialized: new Set(first === undefined ? [] :
    [...first.initialized].filter(declaration => states.every(state => state.initialized.has(declaration)))),
    possiblyInitialized: new Set(states.flatMap(state => [...state.possiblyInitialized])),
    published: states.every(state => state.published) });
}
