import { realpathSync } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolvePath(fileURLToPath(new URL("..", import.meta.url)));
const defaultRoot = resolvePath(repositoryRoot, "../tsonic");
const configuredInput = process.env.TSONIC_ROOT ?? defaultRoot;
const configuredRoot = realpathSync(
  isAbsolute(configuredInput)
    ? configuredInput
    : resolvePath(repositoryRoot, configuredInput),
);
const defaultPrefix = directoryUrl(defaultRoot);
const configuredPrefix = directoryUrl(configuredRoot);
const configuredEntrypoints = new Map([
  ["@tsonic/tsts", "packages/tsts/dist/src/index.js"],
  ["@tsonic/js-source-profile", "packages/js-source-profile/dist/index.js"],
  ["@tsonic/source-core", "packages/source-core/dist/public/index.js"],
  ["@tsonic/source-core/extension", "packages/source-core/dist/public/extension.js"],
  ["@tsonic/source-core/facts", "packages/source-core/dist/public/facts.js"],
  ["@tsonic/target-api", "packages/target-api/dist/public/index.js"],
  ["@tsonic/target-api/analysis", "packages/target-api/dist/public/analysis.js"],
  ["@tsonic/target-api/artifacts", "packages/target-api/dist/public/artifacts.js"],
  ["@tsonic/target-api/provider", "packages/target-api/dist/public/provider.js"],
  ["@tsonic/target-api/source", "packages/target-api/dist/public/source.js"],
]);

export async function resolve(specifier, context, nextResolve) {
  const configuredEntry = configuredEntrypoints.get(specifier);
  if (configuredEntry !== undefined) {
    return {
      shortCircuit: true,
      url: pathToFileURL(resolvePath(configuredRoot, configuredEntry)).href,
    };
  }
  const result = await nextResolve(specifier, context);
  if (configuredPrefix === defaultPrefix || !result.url.startsWith(defaultPrefix)) {
    return result;
  }
  return {
    ...result,
    url: `${configuredPrefix}${result.url.slice(defaultPrefix.length)}`,
  };
}

function directoryUrl(path) {
  const url = pathToFileURL(path).href;
  return url.endsWith("/") ? url : `${url}/`;
}
