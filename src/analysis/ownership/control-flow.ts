import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  CaseBlock_Clauses,
  CaseOrDefaultClause_Expression,
  CaseOrDefaultClause_Statements,
  CatchClause_Block,
  CatchClause_VariableDeclaration,
  ConditionalExpression_Condition,
  ConditionalExpression_WhenFalse,
  ConditionalExpression_WhenTrue,
  DoStatement_Statement,
  ForInOrOfStatement_Initializer,
  ForInOrOfStatement_Statement,
  ForStatement_Condition,
  ForStatement_Incrementor,
  ForStatement_Initializer,
  IfStatement_ElseStatement,
  IfStatement_ThenStatement,
  IterationStatement_Statement,
  Node_Expression,
  SwitchStatement_CaseBlock,
  SwitchStatement_Expression,
  TryStatement_CatchClause,
  TryStatement_FinallyBlock,
  TryStatement_TryBlock,
  sourceNodeIdentity,
} from "@tsonic/target-api/source";
import type { RustLexicalRegionIndex } from "./lexical-regions.js";

const maximumFlowPoints = 1_048_576;
const maximumFlowEdges = 4_194_304;

export interface RustSourceFlowPoint {
  readonly id: string;
  readonly index: number;
  readonly regionId: string;
  readonly lexicalRegionId?: string;
  readonly node?: Node;
  readonly kind: "entry" | "node" | "exit" | "join";
}

export interface RustSourceFlowGraph {
  readonly points: readonly RustSourceFlowPoint[];
  readonly edgeCount: number;
  pointFor(node: Node | undefined): RustSourceFlowPoint | undefined;
  successors(point: RustSourceFlowPoint): readonly RustSourceFlowPoint[];
  predecessors(point: RustSourceFlowPoint): readonly RustSourceFlowPoint[];
  reaches(from: Node | RustSourceFlowPoint, to: Node | RustSourceFlowPoint): boolean;
  repeats(node: Node | RustSourceFlowPoint): boolean;
  pointsOnPaths(
    from: Node | RustSourceFlowPoint,
    to: readonly (Node | RustSourceFlowPoint)[],
  ): readonly RustSourceFlowPoint[];
  regionFor(node: Node | undefined): string | undefined;
  exitsFor(node: SourceFile | Node): readonly RustSourceFlowPoint[];
}

export type BuildRustSourceFlowGraphResult =
  | { readonly kind: "resolved"; readonly graph: RustSourceFlowGraph }
  | { readonly kind: "rejected"; readonly code: string; readonly message: string };

interface FlowFragment {
  readonly entry: number;
  readonly exits: readonly number[];
}

interface FlowContext {
  readonly regionId: string;
  readonly lexicalRegionId: string;
  readonly rootCallable?: Node;
  readonly breakTarget?: number;
  readonly continueTarget?: number;
  readonly returnTarget: number;
  readonly throwTarget: number;
}

interface RegionRecord {
  readonly owner: SourceFile | Node;
  readonly regionId: string;
  readonly entry: number;
  readonly exit: number;
}

class FlowLimitError extends Error {}

export function buildRustSourceFlowGraph(
  ast: AstReader,
  sourceFiles: readonly SourceFile[],
  lexicalRegions: RustLexicalRegionIndex,
): BuildRustSourceFlowGraphResult {
  try {
    return {
      kind: "resolved",
      graph: new SourceFlowGraphBuilder(ast, sourceFiles, lexicalRegions).build(),
    };
  } catch (error) {
    return {
      kind: "rejected",
      code: "RUST_OWNERSHIP_FLOW_GRAPH_LIMIT_EXCEEDED",
      message: error instanceof FlowLimitError
        ? error.message
        : `Rust ownership control-flow construction failed: ${String(error)}`,
    };
  }
}

class SourceFlowGraphBuilder {
  readonly #ast: AstReader;
  readonly #sourceFiles: readonly SourceFile[];
  readonly #lexicalRegions: RustLexicalRegionIndex;
  readonly #points: RustSourceFlowPoint[] = [];
  readonly #pointByNode = new WeakMap<Node, number>();
  readonly #successors: number[][] = [];
  readonly #predecessors: number[][] = [];
  readonly #regions: RegionRecord[] = [];
  readonly #regionByNode = new WeakMap<Node, string>();
  readonly #regionByOwner = new WeakMap<Node, RegionRecord>();
  readonly #callables: Node[] = [];
  readonly #callableSet = new WeakSet<Node>();
  #edgeCount = 0;

  constructor(
    ast: AstReader,
    sourceFiles: readonly SourceFile[],
    lexicalRegions: RustLexicalRegionIndex,
  ) {
    this.#ast = ast;
    this.#sourceFiles = sourceFiles;
    this.#lexicalRegions = lexicalRegions;
  }

  build(): RustSourceFlowGraph {
    for (const sourceFile of this.#sourceFiles) {
      this.#collectCallables(sourceFile);
      this.#buildRegion(sourceFile, undefined);
    }
    for (const callable of this.#callables) {
      this.#buildRegion(callable, callable);
    }
    return this.#seal();
  }

  #collectCallables(root: Node): void {
    const visit = (node: Node): void => {
      if (isCallable(node, this.#ast)) {
        if (!this.#callableSet.has(node)) {
          this.#callableSet.add(node);
          this.#callables.push(node);
        }
      }
      this.#ast.forEachChild(node, (child) => {
        if (child !== undefined) visit(child);
      });
    };
    visit(root);
  }

  #buildRegion(owner: SourceFile | Node, rootCallable: Node | undefined): void {
    const ownerIdentity = sourceNodeIdentity(this.#ast, owner) ??
      `${this.#ast.getPath(this.#ast.getSourceFile(owner))}:${this.#ast.pos(owner)}:${this.#ast.end(owner)}`;
    const regionId = `rust-flow\0${ownerIdentity}`;
    const lexicalRegionId = this.#lexicalRegions.ownedRegionFor(owner)?.id ??
      this.#lexicalRegions.regionFor(owner)?.id;
    if (lexicalRegionId === undefined) {
      throw new Error("Rust flow owner has no exact lexical region.");
    }
    const entry = this.#syntheticPoint(regionId, "entry", "entry", lexicalRegionId);
    const exit = this.#syntheticPoint(regionId, "exit", "exit", undefined);
    const record = { owner, regionId, entry, exit };
    this.#regions.push(record);
    this.#regionByOwner.set(owner, record);
    const context: FlowContext = {
      regionId,
      lexicalRegionId,
      ...(rootCallable === undefined ? {} : { rootCallable }),
      returnTarget: exit,
      throwTarget: exit,
    };
    const body = rootCallable === undefined
      ? this.#sequence(this.#denseStatements(owner), context)
      : this.#callableBody(rootCallable, context);
    if (body === undefined) {
      this.#connect(entry, exit);
      return;
    }
    this.#connect(entry, body.entry);
    for (const normalExit of body.exits) this.#connect(normalExit, exit);
  }

  #callableBody(callable: Node, context: FlowContext): FlowFragment | undefined {
    const parameters = this.#ast.parameters(callable).filter((parameter): parameter is Node =>
      parameter !== undefined);
    const body = this.#ast.body(callable);
    const fragments = parameters.flatMap((parameter) => {
      const fragment = this.#generic(parameter, context);
      return fragment === undefined ? [] : [fragment];
    });
    if (body !== undefined) {
      const bodyFragment = this.#ast.kindName(body) === "KindBlock"
        ? this.#sequence(this.#denseStatements(body), context)
        : this.#buildNode(body, context);
      if (bodyFragment !== undefined) fragments.push(bodyFragment);
    }
    return this.#compose(fragments);
  }

  #buildNode(node: Node, context: FlowContext): FlowFragment {
    context = Object.freeze({
      ...context,
      lexicalRegionId: this.#lexicalRegions.regionFor(node)?.id ?? context.lexicalRegionId,
    });
    this.#regionByNode.set(node, context.regionId);
    const kind = this.#ast.kindName(node);
    if (kind === "KindBlock" || kind === "KindSourceFile") {
      const statements = this.#sequence(this.#denseStatements(node), context);
      const completion = this.#nodePoint(node, context.regionId);
      if (statements === undefined) return { entry: completion, exits: [completion] };
      for (const exit of statements.exits) this.#connect(exit, completion);
      return { entry: statements.entry, exits: [completion] };
    }
    if (isCallable(node, this.#ast) && node !== context.rootCallable) {
      return this.#atomic(node, context.regionId);
    }
    switch (kind) {
      case "KindIfStatement":
        return this.#ifStatement(node, context);
      case "KindConditionalExpression":
        return this.#conditionalExpression(node, context);
      case "KindWhileStatement":
        return this.#whileStatement(node, context);
      case "KindDoStatement":
        return this.#doStatement(node, context);
      case "KindForStatement":
        return this.#forStatement(node, context);
      case "KindForInStatement":
      case "KindForOfStatement":
        return this.#forInOrOfStatement(node, context);
      case "KindSwitchStatement":
        return this.#switchStatement(node, context);
      case "KindTryStatement":
        return this.#tryStatement(node, context);
      case "KindReturnStatement":
        return this.#abruptStatement(node, context, context.returnTarget);
      case "KindThrowStatement":
        return this.#abruptStatement(node, context, context.throwTarget);
      case "KindBreakStatement":
        return this.#abruptStatement(node, context, context.breakTarget ?? context.returnTarget);
      case "KindContinueStatement":
        return this.#abruptStatement(node, context, context.continueTarget ?? context.returnTarget);
      case "KindBinaryExpression":
        if (isShortCircuitOperator(this.#ast.operatorKindName(node))) {
          return this.#shortCircuitExpression(node, context);
        }
        return this.#generic(node, context);
      default:
        return this.#generic(node, context);
    }
  }

  #ifStatement(node: Node, context: FlowContext): FlowFragment {
    const condition = Node_Expression(this.#ast, node);
    const thenNode = IfStatement_ThenStatement(this.#ast, node);
    const elseNode = IfStatement_ElseStatement(this.#ast, node);
    const conditionFlow = condition === undefined
      ? this.#atomic(node, context.regionId)
      : this.#buildNode(condition, context);
    const join = this.#nodePoint(node, context.regionId);
    const thenFlow = thenNode === undefined ? undefined : this.#buildNode(thenNode, context);
    const elseFlow = elseNode === undefined ? undefined : this.#buildNode(elseNode, context);
    for (const exit of conditionFlow.exits) {
      this.#connect(exit, thenFlow?.entry ?? join);
      this.#connect(exit, elseFlow?.entry ?? join);
    }
    for (const exit of thenFlow?.exits ?? []) this.#connect(exit, join);
    for (const exit of elseFlow?.exits ?? []) this.#connect(exit, join);
    return { entry: conditionFlow.entry, exits: [join] };
  }

  #conditionalExpression(node: Node, context: FlowContext): FlowFragment {
    const condition = ConditionalExpression_Condition(this.#ast, node);
    const whenTrue = ConditionalExpression_WhenTrue(this.#ast, node);
    const whenFalse = ConditionalExpression_WhenFalse(this.#ast, node);
    if (condition === undefined || whenTrue === undefined || whenFalse === undefined) {
      return this.#generic(node, context);
    }
    const conditionFlow = this.#buildNode(condition, context);
    const trueFlow = this.#buildNode(whenTrue, context);
    const falseFlow = this.#buildNode(whenFalse, context);
    const join = this.#nodePoint(node, context.regionId);
    for (const exit of conditionFlow.exits) {
      this.#connect(exit, trueFlow.entry);
      this.#connect(exit, falseFlow.entry);
    }
    for (const exit of trueFlow.exits) this.#connect(exit, join);
    for (const exit of falseFlow.exits) this.#connect(exit, join);
    return { entry: conditionFlow.entry, exits: [join] };
  }

  #shortCircuitExpression(node: Node, context: FlowContext): FlowFragment {
    const left = BinaryExpression_Left(this.#ast, node);
    const right = BinaryExpression_Right(this.#ast, node);
    if (left === undefined || right === undefined) return this.#generic(node, context);
    const leftFlow = this.#buildNode(left, context);
    const rightFlow = this.#buildNode(right, context);
    const join = this.#nodePoint(node, context.regionId);
    for (const exit of leftFlow.exits) {
      this.#connect(exit, rightFlow.entry);
      this.#connect(exit, join);
    }
    for (const exit of rightFlow.exits) this.#connect(exit, join);
    return { entry: leftFlow.entry, exits: [join] };
  }

  #whileStatement(node: Node, context: FlowContext): FlowFragment {
    const join = this.#nodePoint(node, context.regionId);
    const conditionNode = Node_Expression(this.#ast, node);
    const condition = conditionNode === undefined
      ? this.#syntheticFragment(context.regionId, "while-condition", context.lexicalRegionId)
      : this.#buildNode(conditionNode, context);
    const bodyNode = IterationStatement_Statement(this.#ast, node);
    const body = bodyNode === undefined
      ? this.#syntheticFragment(context.regionId, "while-body", context.lexicalRegionId)
      : this.#buildNode(bodyNode, { ...context, breakTarget: join, continueTarget: condition.entry });
    for (const exit of condition.exits) {
      this.#connect(exit, body.entry);
      this.#connect(exit, join);
    }
    for (const exit of body.exits) this.#connect(exit, condition.entry);
    return { entry: condition.entry, exits: [join] };
  }

  #doStatement(node: Node, context: FlowContext): FlowFragment {
    const join = this.#nodePoint(node, context.regionId);
    const conditionNode = Node_Expression(this.#ast, node);
    const condition = conditionNode === undefined
      ? this.#syntheticFragment(context.regionId, "do-condition", context.lexicalRegionId)
      : this.#buildNode(conditionNode, context);
    const bodyNode = DoStatement_Statement(this.#ast, node);
    const body = bodyNode === undefined
      ? this.#syntheticFragment(context.regionId, "do-body", context.lexicalRegionId)
      : this.#buildNode(bodyNode, { ...context, breakTarget: join, continueTarget: condition.entry });
    for (const exit of body.exits) this.#connect(exit, condition.entry);
    for (const exit of condition.exits) {
      this.#connect(exit, body.entry);
      this.#connect(exit, join);
    }
    return { entry: body.entry, exits: [join] };
  }

  #forStatement(node: Node, context: FlowContext): FlowFragment {
    const join = this.#nodePoint(node, context.regionId);
    const loopRegionId = this.#lexicalRegions.ownedRegionFor(node)?.id ?? context.lexicalRegionId;
    const initializerNode = ForStatement_Initializer(this.#ast, node);
    const conditionNode = ForStatement_Condition(this.#ast, node);
    const incrementNode = ForStatement_Incrementor(this.#ast, node);
    const initializer = initializerNode === undefined
      ? undefined
      : this.#buildNode(initializerNode, context);
    const condition = conditionNode === undefined
      ? this.#syntheticFragment(context.regionId, "for-condition", loopRegionId)
      : this.#buildNode(conditionNode, context);
    const increment = incrementNode === undefined
      ? this.#syntheticFragment(context.regionId, "for-increment", loopRegionId)
      : this.#buildNode(incrementNode, context);
    const bodyNode = IterationStatement_Statement(this.#ast, node);
    const body = bodyNode === undefined
      ? this.#syntheticFragment(context.regionId, "for-body", loopRegionId)
      : this.#buildNode(bodyNode, { ...context, breakTarget: join, continueTarget: increment.entry });
    for (const exit of initializer?.exits ?? []) this.#connect(exit, condition.entry);
    for (const exit of condition.exits) {
      this.#connect(exit, body.entry);
      this.#connect(exit, join);
    }
    for (const exit of body.exits) this.#connect(exit, increment.entry);
    for (const exit of increment.exits) this.#connect(exit, condition.entry);
    return { entry: initializer?.entry ?? condition.entry, exits: [join] };
  }

  #forInOrOfStatement(node: Node, context: FlowContext): FlowFragment {
    const join = this.#nodePoint(node, context.regionId);
    const loopRegionId = this.#lexicalRegions.ownedRegionFor(node)?.id ?? context.lexicalRegionId;
    const expressionNode = Node_Expression(this.#ast, node);
    const initializerNode = ForInOrOfStatement_Initializer(this.#ast, node);
    const iterable = expressionNode === undefined
      ? this.#syntheticFragment(context.regionId, "for-of-iterable", loopRegionId)
      : this.#buildNode(expressionNode, context);
    const initializer = initializerNode === undefined
      ? this.#syntheticFragment(context.regionId, "for-of-binding", loopRegionId)
      : this.#buildNode(initializerNode, context);
    const bodyNode = ForInOrOfStatement_Statement(this.#ast, node);
    const body = bodyNode === undefined
      ? this.#syntheticFragment(context.regionId, "for-of-body", loopRegionId)
      : this.#buildNode(bodyNode, { ...context, breakTarget: join, continueTarget: initializer.entry });
    for (const exit of iterable.exits) {
      this.#connect(exit, initializer.entry);
      this.#connect(exit, join);
    }
    for (const exit of initializer.exits) this.#connect(exit, body.entry);
    for (const exit of body.exits) {
      this.#connect(exit, initializer.entry);
      this.#connect(exit, join);
    }
    return { entry: iterable.entry, exits: [join] };
  }

  #switchStatement(node: Node, context: FlowContext): FlowFragment {
    const join = this.#nodePoint(node, context.regionId);
    const expressionNode = SwitchStatement_Expression(this.#ast, node);
    const expression = expressionNode === undefined
      ? this.#syntheticFragment(context.regionId, "switch-expression", context.lexicalRegionId)
      : this.#buildNode(expressionNode, context);
    const clauses = (CaseBlock_Clauses(
      this.#ast,
      SwitchStatement_CaseBlock(this.#ast, node),
    ) ?? []).filter((clause): clause is Node => clause !== undefined);
    if (clauses.length === 0) {
      for (const exit of expression.exits) this.#connect(exit, join);
      return { entry: expression.entry, exits: [join] };
    }
    const flows = clauses.map((clause) => {
      const test = CaseOrDefaultClause_Expression(this.#ast, clause);
      const statements = (CaseOrDefaultClause_Statements(this.#ast, clause) ?? [])
        .filter((statement): statement is Node => statement !== undefined);
      const statementsFlow = this.#sequence(statements, { ...context, breakTarget: join });
      const parts = [
        ...(test === undefined ? [] : [this.#buildNode(test, context)]),
        ...(statementsFlow === undefined ? [] : [statementsFlow]),
        this.#atomic(clause, context.regionId),
      ];
      return this.#compose(parts)!;
    });
    for (const exit of expression.exits) {
      for (const flow of flows) this.#connect(exit, flow.entry);
      this.#connect(exit, join);
    }
    for (let index = 0; index < flows.length; index += 1) {
      for (const exit of flows[index]!.exits) {
        this.#connect(exit, flows[index + 1]?.entry ?? join);
      }
    }
    return { entry: expression.entry, exits: [join] };
  }

  #tryStatement(node: Node, context: FlowContext): FlowFragment {
    const join = this.#nodePoint(node, context.regionId);
    const catchClause = TryStatement_CatchClause(this.#ast, node);
    const catchVariable = CatchClause_VariableDeclaration(this.#ast, catchClause);
    const catchBlock = CatchClause_Block(this.#ast, catchClause);
    const finallyBlock = TryStatement_FinallyBlock(this.#ast, node);
    const finallyFlow = finallyBlock === undefined
      ? undefined
      : this.#buildNode(finallyBlock, context);
    const catchEntry = catchBlock === undefined
      ? undefined
      : this.#syntheticPoint(
          context.regionId,
          "join",
          "catch-entry",
          this.#lexicalRegions.ownedRegionFor(catchClause)?.id ?? context.lexicalRegionId,
        );
    const finallyEntry = finallyFlow?.entry;
    const finallyContinuations = new Set<number>();
    const throughFinally = (target: number): number => {
      if (finallyEntry === undefined) return target;
      finallyContinuations.add(target);
      return finallyEntry;
    };
    const tryBlock = TryStatement_TryBlock(this.#ast, node);
    const tryFlow = tryBlock === undefined
      ? this.#syntheticFragment(context.regionId, "try-body", context.lexicalRegionId)
      : this.#buildNode(tryBlock, {
          ...context,
          returnTarget: throughFinally(context.returnTarget),
          ...(context.breakTarget === undefined
            ? {}
            : { breakTarget: throughFinally(context.breakTarget) }),
          ...(context.continueTarget === undefined
            ? {}
            : { continueTarget: throughFinally(context.continueTarget) }),
          throwTarget: catchEntry ?? throughFinally(context.throwTarget),
        });
    const catchContext = {
      ...context,
      lexicalRegionId: this.#lexicalRegions.ownedRegionFor(catchClause)?.id ??
        context.lexicalRegionId,
      returnTarget: throughFinally(context.returnTarget),
      ...(context.breakTarget === undefined
        ? {}
        : { breakTarget: throughFinally(context.breakTarget) }),
      ...(context.continueTarget === undefined
        ? {}
        : { continueTarget: throughFinally(context.continueTarget) }),
      throwTarget: throughFinally(context.throwTarget),
    };
    const catchFlow = this.#compose([
      ...(catchVariable === undefined ? [] : [this.#buildNode(catchVariable, catchContext)]),
      ...(catchBlock === undefined ? [] : [this.#buildNode(catchBlock, catchContext)]),
    ]);
    if (catchEntry !== undefined && catchFlow !== undefined) this.#connect(catchEntry, catchFlow.entry);
    for (const exit of [...tryFlow.exits, ...(catchFlow?.exits ?? [])]) {
      this.#connect(exit, finallyEntry ?? join);
    }
    if (finallyFlow !== undefined) {
      finallyContinuations.add(join);
      for (const exit of finallyFlow.exits) {
        for (const continuation of finallyContinuations) {
          this.#connect(exit, continuation);
        }
      }
    }
    return { entry: tryFlow.entry, exits: [join] };
  }

  #abruptStatement(node: Node, context: FlowContext, target: number): FlowFragment {
    const expression = Node_Expression(this.#ast, node);
    const expressionFlow = expression === undefined ? undefined : this.#buildNode(expression, context);
    const point = this.#nodePoint(node, context.regionId);
    for (const exit of expressionFlow?.exits ?? []) this.#connect(exit, point);
    this.#connect(point, target);
    return { entry: expressionFlow?.entry ?? point, exits: [] };
  }

  #generic(node: Node, context: FlowContext): FlowFragment {
    const children: Node[] = [];
    this.#ast.forEachChild(node, (child) => {
      if (child !== undefined && !this.#skipCallableBody(node, child, context)) children.push(child);
    });
    const childFlow = this.#compose(children.map((child) => this.#buildNode(child, context)));
    const point = this.#nodePoint(node, context.regionId);
    if (childFlow === undefined) return { entry: point, exits: [point] };
    for (const exit of childFlow.exits) this.#connect(exit, point);
    return { entry: childFlow.entry, exits: [point] };
  }

  #skipCallableBody(parent: Node, child: Node, context: FlowContext): boolean {
    return isCallable(parent, this.#ast) && parent !== context.rootCallable &&
      this.#ast.body(parent) === child;
  }

  #sequence(nodes: readonly Node[], context: FlowContext): FlowFragment | undefined {
    return this.#compose(nodes.map((node) => this.#buildNode(node, context)));
  }

  #compose(fragments: readonly FlowFragment[]): FlowFragment | undefined {
    const [first] = fragments;
    if (first === undefined) return undefined;
    let exits = first.exits;
    for (const fragment of fragments.slice(1)) {
      for (const exit of exits) this.#connect(exit, fragment.entry);
      exits = fragment.exits;
    }
    return { entry: first.entry, exits };
  }

  #atomic(node: Node, regionId: string): FlowFragment {
    const point = this.#nodePoint(node, regionId);
    return { entry: point, exits: [point] };
  }

  #syntheticFragment(
    regionId: string,
    label: string,
    lexicalRegionId: string,
  ): FlowFragment {
    const point = this.#syntheticPoint(regionId, "join", label, lexicalRegionId);
    return { entry: point, exits: [point] };
  }

  #nodePoint(node: Node, regionId: string): number {
    const existing = this.#pointByNode.get(node);
    if (existing !== undefined) return existing;
    const point = this.#appendPoint({
      id: `${regionId}\0node:${this.#ast.kind(node)}:${this.#ast.pos(node)}:${this.#ast.end(node)}`,
      regionId,
      lexicalRegionId: this.#lexicalRegions.regionFor(node)?.id,
      node,
      kind: "node",
    });
    this.#pointByNode.set(node, point);
    this.#regionByNode.set(node, regionId);
    return point;
  }

  #syntheticPoint(
    regionId: string,
    kind: RustSourceFlowPoint["kind"],
    label: string,
    lexicalRegionId: string | undefined,
  ): number {
    return this.#appendPoint({
      id: `${regionId}\0${label}:${this.#points.length}`,
      regionId,
      ...(lexicalRegionId === undefined ? {} : { lexicalRegionId }),
      kind,
    });
  }

  #appendPoint(point: Omit<RustSourceFlowPoint, "index">): number {
    if (this.#points.length >= maximumFlowPoints) {
      throw new FlowLimitError(
        `Rust ownership analysis exceeded its ${maximumFlowPoints}-point control-flow budget.`,
      );
    }
    const index = this.#points.length;
    this.#points.push(Object.freeze({ ...point, index }));
    this.#successors.push([]);
    this.#predecessors.push([]);
    return index;
  }

  #connect(from: number, to: number): void {
    const successors = this.#successors[from]!;
    if (successors.includes(to)) return;
    if (this.#edgeCount >= maximumFlowEdges) {
      throw new FlowLimitError(
        `Rust ownership analysis exceeded its ${maximumFlowEdges}-edge control-flow budget.`,
      );
    }
    successors.push(to);
    this.#predecessors[to]!.push(from);
    this.#edgeCount += 1;
  }

  #denseStatements(node: Node): readonly Node[] {
    return this.#ast.statements(node).filter((statement): statement is Node => statement !== undefined);
  }

  #seal(): RustSourceFlowGraph {
    const points = Object.freeze([...this.#points]);
    const successors = Object.freeze(this.#successors.map((entries) => Object.freeze([...entries])));
    const predecessors = Object.freeze(this.#predecessors.map((entries) => Object.freeze([...entries])));
    const cyclic = computeCyclicPoints(successors);
    const reachability = new Map<string, boolean>();
    const pointIndex = (value: Node | RustSourceFlowPoint): number | undefined =>
      "index" in value && typeof value.index === "number"
        ? value.index
        : this.#pointByNode.get(value as Node);
    const reachesIndex = (from: number, to: number): boolean => {
      const key = `${from}:${to}`;
      const cached = reachability.get(key);
      if (cached !== undefined) return cached;
      if (from === to) {
        const result = cyclic.has(from);
        reachability.set(key, result);
        return result;
      }
      const pending = [...successors[from]!];
      const seen = new Set<number>([from]);
      while (pending.length > 0) {
        const current = pending.pop()!;
        if (current === to) {
          reachability.set(key, true);
          return true;
        }
        if (seen.has(current)) continue;
        seen.add(current);
        pending.push(...successors[current]!);
      }
      reachability.set(key, false);
      return false;
    };
    const graph: RustSourceFlowGraph = Object.freeze({
      points,
      edgeCount: this.#edgeCount,
      pointFor: (node: Node | undefined) => {
        const index = node === undefined ? undefined : this.#pointByNode.get(node);
        return index === undefined ? undefined : points[index];
      },
      successors: (point: RustSourceFlowPoint) =>
        Object.freeze(successors[point.index]!.map((index) => points[index]!)),
      predecessors: (point: RustSourceFlowPoint) =>
        Object.freeze(predecessors[point.index]!.map((index) => points[index]!)),
      reaches: (from: Node | RustSourceFlowPoint, to: Node | RustSourceFlowPoint) => {
        const fromIndex = pointIndex(from);
        const toIndex = pointIndex(to);
        return fromIndex !== undefined && toIndex !== undefined &&
          points[fromIndex]!.regionId === points[toIndex]!.regionId &&
          reachesIndex(fromIndex, toIndex);
      },
      repeats: (node: Node | RustSourceFlowPoint) => {
        const index = pointIndex(node);
        return index !== undefined && cyclic.has(index);
      },
      pointsOnPaths: (
        from: Node | RustSourceFlowPoint,
        targets: readonly (Node | RustSourceFlowPoint)[],
      ) => {
        const fromIndex = pointIndex(from);
        const targetIndexes = targets.map(pointIndex).filter((index): index is number =>
          index !== undefined && (fromIndex === undefined ||
            points[index]!.regionId === points[fromIndex]!.regionId));
        if (fromIndex === undefined || targetIndexes.length === 0) return Object.freeze([]);
        const forward = reachableSet(fromIndex, successors, true);
        const backward = new Set<number>();
        for (const target of targetIndexes) {
          for (const index of reachableSet(target, predecessors, true)) backward.add(index);
        }
        return Object.freeze(points.filter((point) =>
          point.regionId === points[fromIndex]!.regionId &&
          forward.has(point.index) && backward.has(point.index)));
      },
      regionFor: (node: Node | undefined) => node === undefined
        ? undefined
        : this.#regionByNode.get(node),
      exitsFor: (owner: SourceFile | Node) => {
        const record = this.#regionByOwner.get(owner);
        return record === undefined ? Object.freeze([]) : Object.freeze([points[record.exit]!]);
      },
    });
    return graph;
  }
}

function reachableSet(
  start: number,
  edges: readonly (readonly number[])[],
  includeStart: boolean,
): ReadonlySet<number> {
  const seen = new Set<number>(includeStart ? [start] : []);
  const pending = [...edges[start]!];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    pending.push(...edges[current]!);
  }
  return seen;
}

function computeCyclicPoints(
  successors: readonly (readonly number[])[],
): ReadonlySet<number> {
  let nextIndex = 0;
  const indexes = new Array<number>(successors.length).fill(-1);
  const lowLinks = new Array<number>(successors.length).fill(-1);
  const stack: number[] = [];
  const onStack = new Set<number>();
  const cyclic = new Set<number>();
  const visit = (point: number): void => {
    indexes[point] = nextIndex;
    lowLinks[point] = nextIndex;
    nextIndex += 1;
    stack.push(point);
    onStack.add(point);
    for (const successor of successors[point]!) {
      if (indexes[successor] === -1) {
        visit(successor);
        lowLinks[point] = Math.min(lowLinks[point]!, lowLinks[successor]!);
      } else if (onStack.has(successor)) {
        lowLinks[point] = Math.min(lowLinks[point]!, indexes[successor]!);
      }
    }
    if (lowLinks[point] !== indexes[point]) return;
    const component: number[] = [];
    for (;;) {
      const selected = stack.pop()!;
      onStack.delete(selected);
      component.push(selected);
      if (selected === point) break;
    }
    if (component.length > 1 || successors[point]!.includes(point)) {
      component.forEach((selected) => cyclic.add(selected));
    }
  };
  for (let point = 0; point < successors.length; point += 1) {
    if (indexes[point] === -1) visit(point);
  }
  return cyclic;
}

function isCallable(node: Node, ast: AstReader): boolean {
  const kind = ast.kindName(node);
  return kind === "KindFunctionDeclaration" || kind === "KindFunctionExpression" ||
    kind === "KindArrowFunction" || kind === "KindMethodDeclaration" ||
    kind === "KindConstructor" || kind === "KindGetAccessor" ||
    kind === "KindSetAccessor";
}

function isShortCircuitOperator(kind: string | undefined): boolean {
  return kind === "KindAmpersandAmpersandToken" || kind === "KindBarBarToken" ||
    kind === "KindQuestionQuestionToken";
}
