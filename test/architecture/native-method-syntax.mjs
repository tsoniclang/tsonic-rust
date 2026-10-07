import { createCompilerSessionFromFiles } from "../../../tsonic/packages/tsts/dist/src/index.js";

export function maskNativeMethodLiterals(sources) {
  const files = new Map();
  const identities = new Map();
  for (const [path, text] of sources) {
    const file = `/architecture/native-syntax-${files.size}.ts`;
    files.set(file, text);
    identities.set(file, path);
  }
  if (files.size === 0) return new Map();
  const source = createCompilerSessionFromFiles({ currentDirectory: "/architecture", files,
    rootFiles: [...files.keys()], compilerOptions: { module: "esnext", moduleResolution: "bundler",
      noLib: true, noResolve: true, skipLibCheck: true, target: "esnext" } }).checkSource();
  const result = new Map();
  const { ast } = source;
  for (const file of source.sourceFiles) {
    const name = ast.getFileName(file);
    const path = identities.get(name);
    if (path === undefined) continue;
    const text = Buffer.from(files.get(name), "utf8");
    const visit = node => {
      if (ast.is.IsObjectLiteralExpression(node)) {
        const properties = ast.properties(node).filter(property => property !== undefined &&
          (ast.is.IsPropertyAssignment(property) || ast.is.IsShorthandPropertyAssignment(property)));
        const value = key => {
          const property = properties.find(property => {
            const name = ast.name(property);
            return name !== undefined && (ast.is.IsIdentifier(name) || ast.is.IsStringLiteral(name)) && ast.text(name) === key;
          });
          return property === undefined ? undefined : ast.is.IsShorthandPropertyAssignment(property)
            ? ast.name(property) : ast.as.AsPropertyAssignment(property).Initializer;
        };
        const kind = value("kind");
        const method = value("method");
        if (kind !== undefined && ast.is.IsStringLiteral(kind) && ast.text(kind) === "method-call" &&
          value("receiver") !== undefined && value("args") !== undefined && method !== undefined && ast.is.IsStringLiteral(method)) {
          text.fill(32, ast.pos(method), ast.end(method));
        }
      }
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    visit(file);
    result.set(path, text.toString("utf8"));
  }
  return result;
}
