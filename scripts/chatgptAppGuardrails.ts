import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type ToolSnapshot = {
  name: string;
  descriptionHash: string;
  inputSchema: JsonValue;
  inputSchemaHash: string;
  annotations: JsonValue;
  annotationsHash: string;
  openaiSafety: string | null;
  visibilityCall: string | null;
  outputSchema: JsonValue | null;
  structuredContentShape: {
    declaresOutputSchema: boolean;
    returnsTextContent: boolean;
    returnsStructuredContent: boolean;
  };
};

type ApprovalSnapshot = {
  snapshotVersion: 1;
  publicTools: string[];
  manifest: JsonValue;
  openapi: JsonValue;
  mcpDescriptors: {
    publicToolsFromVisibilityFunction: string[];
    publicTools: Record<string, ToolSnapshot>;
  };
  approvalSensitiveFiles: Array<{
    path: string;
    sha256: string;
  }>;
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const snapshotPath = path.join(repoRoot, "docs/approval-snapshots/chatgpt-app-approval.snapshot.json");

const expectedPublicTools = ["search_activities", "register_for_activity"];

const manifestRequiredPaths = [
  "schema_version",
  "name_for_human",
  "name_for_model",
  "description_for_human",
  "description_for_model",
  "auth.type",
  "auth.authorization_url",
  "auth.token_url",
  "auth.scope",
  "auth.redirect_urls",
  "api.type",
  "api.server_url",
  "logo_url",
  "contact_email",
  "legal_info_url",
];

const expectedOpenApiRoutes = [
  { path: "/orchestrator/chat", method: "post", operationId: "register_for_activity" },
  { path: "/signupassist/start", method: "get", operationId: "search_activities" },
];

const approvalSensitiveStaticPaths = [
  "mcp/manifest.json",
  "mcp/openapi.json",
  "public/.well-known/ai-plugin.json",
  "public/.well-known/chatgpt-apps-manifest.json",
  "public/.well-known/openai-apps-challenge",
  "public/logo-512.png",
  "public/logo-512.svg",
  "mcp_server/index.ts",
  "mcp_server/middleware/auth0.ts",
  "mcp_server/config/protectedActions.ts",
  "mcp_server/ai/APIOrchestrator.ts",
  "scripts/smokeMcpSse.ts",
  "scripts/smokeApiOnly.ts",
  "scripts/v1_endpoint_smoke.sh",
  "scripts/v1_preflight.ts",
  "scripts/testOpenAISmokeTest.ts",
  "docs/CHATGPT_SUBMISSION_CHECKLIST.md",
  "docs/OPENAI_REVIEWER_TEST_CASES.md",
  "docs/REVIEW_TEST_ACCOUNT.md",
  "docs/SAFETY_POLICY.md",
  "docs/PRIVACY_POLICY.md",
];

const approvalSensitiveRecursiveDirs = ["mcp_server/providers"];

const requiredProtectedActions = [
  "setup_payment_method",
  "setup_payment",
  "show_payment_authorization",
  "authorize_payment",
  "confirm_payment",
  "schedule_auto_registration",
  "confirm_scheduled_registration",
  "view_receipts",
  "view_audit_trail",
  "cancel_registration",
  "confirm_cancel_registration",
  "load_saved_children",
  "save_child",
  "load_delegate_profile",
  "save_delegate_profile",
  "check_payment_method",
];

function repoPath(relativePath: string): string {
  return path.join(repoRoot, relativePath);
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function readText(relativePath: string): string {
  return readFileSync(repoPath(relativePath), "utf8");
}

function readJson(relativePath: string): JsonValue {
  return JSON.parse(readText(relativePath)) as JsonValue;
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function sha256File(relativePath: string): string {
  return createHash("sha256").update(readFileSync(repoPath(relativePath))).digest("hex");
}

function stableStringify(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function hashJson(value: JsonValue): string {
  return sha256Text(stableStringify(value));
}

function getPath(value: JsonValue, dotPath: string): JsonValue | undefined {
  let current: JsonValue | undefined = value;
  for (const segment of dotPath.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function walkFiles(relativeDir: string): string[] {
  const absoluteDir = repoPath(relativeDir);
  if (!existsSync(absoluteDir)) return [];

  const files: string[] = [];
  for (const entry of readdirSync(absoluteDir).sort()) {
    const absoluteEntry = path.join(absoluteDir, entry);
    const relativeEntry = toPosix(path.relative(repoRoot, absoluteEntry));
    const stat = statSync(absoluteEntry);
    if (stat.isDirectory()) {
      files.push(...walkFiles(relativeEntry));
    } else if (stat.isFile()) {
      files.push(relativeEntry);
    }
  }
  return files;
}

function getApprovalSensitiveFiles(): string[] {
  const files = new Set<string>();

  for (const filePath of approvalSensitiveStaticPaths) {
    files.add(filePath);
  }

  for (const dirPath of approvalSensitiveRecursiveDirs) {
    for (const filePath of walkFiles(dirPath)) {
      files.add(filePath);
    }
  }

  return [...files].sort();
}

function containsLocalhost(value: JsonValue): boolean {
  if (typeof value === "string") {
    return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(value);
  }
  if (Array.isArray(value)) return value.some(containsLocalhost);
  if (value && typeof value === "object") return Object.values(value).some(containsLocalhost);
  return false;
}

function assertCondition(condition: boolean, message: string, failures: string[]): void {
  if (!condition) failures.push(message);
}

function getUrlPath(value: JsonValue | undefined): string | null {
  if (typeof value !== "string") return null;
  try {
    return new URL(value).pathname;
  } catch {
    return null;
  }
}

function summarizeManifest(): JsonValue {
  const manifest = readJson("mcp/manifest.json");
  const wellKnownManifest = readJson("public/.well-known/chatgpt-apps-manifest.json");

  return {
    path: "mcp/manifest.json",
    sha256: sha256File("mcp/manifest.json"),
    wellKnownManifestSha256: sha256File("public/.well-known/chatgpt-apps-manifest.json"),
    requiredFieldValues: Object.fromEntries(
      manifestRequiredPaths.map((fieldPath) => [fieldPath, getPath(manifest, fieldPath) ?? null])
    ) as { [key: string]: JsonValue },
    wellKnownMatchesMcpManifest: stableStringify(manifest) === stableStringify(wellKnownManifest),
  };
}

function checkManifest(failures: string[]): void {
  assertCondition(existsSync(repoPath("mcp/manifest.json")), "mcp/manifest.json is missing", failures);
  assertCondition(
    existsSync(repoPath("public/.well-known/chatgpt-apps-manifest.json")),
    "public/.well-known/chatgpt-apps-manifest.json is missing",
    failures
  );
  if (failures.length > 0) return;

  const manifest = readJson("mcp/manifest.json");
  const serverSource = readText("mcp_server/index.ts");

  for (const fieldPath of manifestRequiredPaths) {
    assertCondition(getPath(manifest, fieldPath) !== undefined, `manifest missing required field: ${fieldPath}`, failures);
  }

  assertCondition(!containsLocalhost(manifest), "manifest contains localhost/loopback production URL", failures);
  assertCondition(getPath(manifest, "auth.type") === "oauth", "manifest auth.type must remain oauth", failures);
  assertCondition(getPath(manifest, "api.type") === "mcp", "manifest api.type must remain mcp", failures);

  const logoPath = getUrlPath(getPath(manifest, "logo_url"));
  assertCondition(logoPath === "/logo-512.svg", "manifest logo_url should reference /logo-512.svg", failures);
  if (logoPath) {
    assertCondition(existsSync(repoPath(path.join("public", logoPath))), `manifest logo resource missing: public${logoPath}`, failures);
  }

  const legalPath = getUrlPath(getPath(manifest, "legal_info_url"));
  assertCondition(legalPath === "/safety", "manifest legal_info_url should reference /safety", failures);
  assertCondition(serverSource.includes("url.pathname === '/safety'"), "server route for /safety is missing", failures);

  const serverPath = getUrlPath(getPath(manifest, "api.server_url"));
  assertCondition(serverPath === "/sse", "manifest api.server_url should reference /sse", failures);
  assertCondition(serverSource.includes("url.pathname === '/sse'"), "server route for /sse is missing", failures);

  const authorizationPath = getUrlPath(getPath(manifest, "auth.authorization_url"));
  const tokenPath = getUrlPath(getPath(manifest, "auth.token_url"));
  assertCondition(authorizationPath === "/oauth/authorize", "manifest auth.authorization_url should reference /oauth/authorize", failures);
  assertCondition(tokenPath === "/oauth/token", "manifest auth.token_url should reference /oauth/token", failures);
  assertCondition(serverSource.includes("url.pathname === '/oauth/authorize'"), "server route for /oauth/authorize is missing", failures);
  assertCondition(serverSource.includes("url.pathname === '/oauth/token'"), "server route for /oauth/token is missing", failures);
}

function summarizeOpenApi(): JsonValue {
  const openapi = readJson("mcp/openapi.json") as { [key: string]: JsonValue };
  const paths = openapi.paths && typeof openapi.paths === "object" && !Array.isArray(openapi.paths)
    ? openapi.paths as { [key: string]: JsonValue }
    : {};

  const routes = expectedOpenApiRoutes.map((route) => {
    const pathItem = paths[route.path] as { [key: string]: JsonValue } | undefined;
    const operation = pathItem?.[route.method] as { [key: string]: JsonValue } | undefined;
    return {
      path: route.path,
      method: route.method,
      operationId: operation?.operationId ?? null,
      consequential: operation?.["x-openai-isConsequential"] ?? null,
      requestBodyHash: operation?.requestBody ? hashJson(operation.requestBody) : null,
      parametersHash: operation?.parameters ? hashJson(operation.parameters) : null,
      responsesHash: operation?.responses ? hashJson(operation.responses) : null,
      securityHash: operation?.security ? hashJson(operation.security) : null,
    };
  });

  return {
    path: "mcp/openapi.json",
    sha256: sha256File("mcp/openapi.json"),
    serverUrls: Array.isArray(openapi.servers)
      ? openapi.servers.map((server) =>
          server && typeof server === "object" && !Array.isArray(server) ? server.url ?? null : null
        )
      : [],
    routes,
  };
}

function getOpenApiOperationIds(openapi: JsonValue): string[] {
  if (!openapi || typeof openapi !== "object" || Array.isArray(openapi)) return [];
  const paths = openapi.paths;
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) return [];

  const operationIds: string[] = [];
  for (const pathItem of Object.values(paths)) {
    if (!pathItem || typeof pathItem !== "object" || Array.isArray(pathItem)) continue;
    for (const operation of Object.values(pathItem)) {
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) continue;
      if (typeof operation.operationId === "string") operationIds.push(operation.operationId);
    }
  }
  return operationIds.sort();
}

function checkOpenApi(failures: string[]): void {
  assertCondition(existsSync(repoPath("mcp/openapi.json")), "mcp/openapi.json is missing", failures);
  if (failures.length > 0) return;

  const openapi = readJson("mcp/openapi.json");
  const operationIds = getOpenApiOperationIds(openapi);
  assertCondition(
    stableStringify(operationIds) === stableStringify(expectedPublicTools.slice().sort()),
    `OpenAPI operationIds changed. Expected ${expectedPublicTools.join(", ")}; got ${operationIds.join(", ")}`,
    failures
  );
  assertCondition(!containsLocalhost(openapi), "OpenAPI contains localhost/loopback production URL", failures);

  if (!openapi || typeof openapi !== "object" || Array.isArray(openapi)) {
    failures.push("OpenAPI root is not an object");
    return;
  }

  for (const route of expectedOpenApiRoutes) {
    const paths = openapi.paths as { [key: string]: JsonValue } | undefined;
    const pathItem = paths?.[route.path] as { [key: string]: JsonValue } | undefined;
    const operation = pathItem?.[route.method] as { [key: string]: JsonValue } | undefined;
    assertCondition(Boolean(operation), `OpenAPI route missing: ${route.method.toUpperCase()} ${route.path}`, failures);
    assertCondition(operation?.operationId === route.operationId, `OpenAPI operationId mismatch for ${route.path}`, failures);
  }
}

function getPropertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function evaluateLiteral(node: ts.Node): JsonValue {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(evaluateLiteral);
  if (ts.isObjectLiteralExpression(node)) {
    const result: { [key: string]: JsonValue } = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = getPropertyName(property.name);
      if (!key) continue;
      result[key] = evaluateLiteral(property.initializer);
    }
    return result;
  }
  return node.getText();
}

function getObjectProperty(objectLiteral: ts.ObjectLiteralExpression, propertyName: string): ts.Expression | null {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = getPropertyName(property.name);
    if (key === propertyName) return property.initializer;
  }
  return null;
}

function isThisToolsSetCall(node: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  if (node.expression.name.text !== "set") return false;
  const target = node.expression.expression;
  return ts.isPropertyAccessExpression(target) && target.name.text === "tools" && target.expression.kind === ts.SyntaxKind.ThisKeyword;
}

function extractToolObjectLiterals(): Map<string, ts.ObjectLiteralExpression> {
  const sourceText = readText("mcp_server/index.ts");
  const sourceFile = ts.createSourceFile("mcp_server/index.ts", sourceText, ts.ScriptTarget.Latest, true);
  const tools = new Map<string, ts.ObjectLiteralExpression>();

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isThisToolsSetCall(node)) {
      const [nameNode, toolNode] = node.arguments;
      if (nameNode && ts.isStringLiteral(nameNode) && toolNode && ts.isObjectLiteralExpression(toolNode)) {
        tools.set(nameNode.text, toolNode);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return tools;
}

function extractPublicToolsFromVisibilityFunction(): string[] {
  const sourceText = readText("mcp_server/index.ts");
  const matches = [...sourceText.matchAll(/if\s*\(\s*toolName\s*===\s*["']([^"']+)["']\s*\)\s*return\s*["']public["']/g)];
  return matches.map((match) => match[1]).sort();
}

function extractToolSnapshot(toolName: string, toolObject: ts.ObjectLiteralExpression): ToolSnapshot {
  const descriptionNode = getObjectProperty(toolObject, "description");
  const inputSchemaNode = getObjectProperty(toolObject, "inputSchema");
  const annotationsNode = getObjectProperty(toolObject, "annotations");
  const metaNode = getObjectProperty(toolObject, "_meta");
  const outputSchemaNode = getObjectProperty(toolObject, "outputSchema");
  const handlerNode = getObjectProperty(toolObject, "handler");

  const descriptionText = descriptionNode ? descriptionNode.getText() : "";
  const inputSchema = inputSchemaNode ? evaluateLiteral(inputSchemaNode) : null;
  const annotations = annotationsNode ? evaluateLiteral(annotationsNode) : null;
  const metaSource = metaNode ? metaNode.getText() : "";
  const handlerSource = handlerNode ? handlerNode.getText() : "";
  const safetyMatch = metaSource.match(/["']openai\/safety["']\s*:\s*["']([^"']+)["']/);
  const visibilityMatch = metaSource.match(/applyV1Visibility\(([^)]*)\)/);

  return {
    name: toolName,
    descriptionHash: sha256Text(descriptionText),
    inputSchema,
    inputSchemaHash: hashJson(inputSchema),
    annotations,
    annotationsHash: hashJson(annotations),
    openaiSafety: safetyMatch?.[1] ?? null,
    visibilityCall: visibilityMatch?.[0] ?? null,
    outputSchema: outputSchemaNode ? evaluateLiteral(outputSchemaNode) : null,
    structuredContentShape: {
      declaresOutputSchema: Boolean(outputSchemaNode),
      returnsTextContent: /content\s*:\s*\[\s*\{\s*type\s*:\s*["']text["']/.test(handlerSource),
      returnsStructuredContent: /structuredContent/.test(handlerSource),
    },
  };
}

function summarizeMcpDescriptors(): ApprovalSnapshot["mcpDescriptors"] {
  const toolObjects = extractToolObjectLiterals();
  const publicTools: Record<string, ToolSnapshot> = {};

  for (const toolName of expectedPublicTools) {
    const toolObject = toolObjects.get(toolName);
    if (toolObject) publicTools[toolName] = extractToolSnapshot(toolName, toolObject);
  }

  return {
    publicToolsFromVisibilityFunction: extractPublicToolsFromVisibilityFunction(),
    publicTools,
  };
}

function checkDescriptors(failures: string[]): void {
  const toolObjects = extractToolObjectLiterals();
  const publicToolsFromVisibility = extractPublicToolsFromVisibilityFunction();

  assertCondition(
    stableStringify(publicToolsFromVisibility) === stableStringify(expectedPublicTools.slice().sort()),
    `public MCP tools changed. Expected ${expectedPublicTools.join(", ")}; got ${publicToolsFromVisibility.join(", ")}`,
    failures
  );

  for (const toolName of expectedPublicTools) {
    assertCondition(toolObjects.has(toolName), `public MCP tool is not registered in mcp_server/index.ts: ${toolName}`, failures);
  }

  const descriptors = summarizeMcpDescriptors().publicTools;
  const search = descriptors.search_activities;
  const register = descriptors.register_for_activity;

  assertCondition(Boolean(search), "search_activities descriptor could not be extracted", failures);
  assertCondition(Boolean(register), "register_for_activity descriptor could not be extracted", failures);

  if (search) {
    assertCondition(search.openaiSafety === "read-only", "search_activities openai/safety must remain read-only", failures);
    assertCondition(search.visibilityCall?.includes('"search_activities"') ?? false, "search_activities must apply V1 visibility", failures);
    assertCondition(
      stableStringify(search.annotations) === stableStringify({ destructiveHint: false, openWorldHint: false, readOnlyHint: true }),
      "search_activities annotations changed from read-only posture",
      failures
    );
  }

  if (register) {
    assertCondition(register.openaiSafety === "write", "register_for_activity openai/safety must remain write", failures);
    assertCondition(register.visibilityCall?.includes('"register_for_activity"') ?? false, "register_for_activity must apply V1 visibility", failures);
    assertCondition(
      stableStringify(register.annotations) === stableStringify({ destructiveHint: true, openWorldHint: false, readOnlyHint: false }),
      "register_for_activity annotations changed from consequential posture",
      failures
    );
  }

  const sourceText = readText("mcp_server/index.ts");
  assertCondition(sourceText.includes("MCP_LISTTOOLS_INCLUDE_PRIVATE"), "ListTools private diagnostic flag is missing", failures);
  assertCondition(
    sourceText.includes('apiTools.filter(t => t._meta?.["openai/visibility"] === "public")') ||
      sourceText.includes('apiTools.filter((t) => t._meta?.["openai/visibility"] === "public")') ||
      sourceText.includes('apiTools.filter((tool) => tool._meta?.["openai/visibility"] === "public")'),
    "ListTools public-only filter is missing",
    failures
  );
  assertCondition(sourceText.includes('tool?._meta?.["openai/visibility"] !== "private"'), "ListTools private exclusion filter is missing", failures);
}

function summarizeApprovalSensitiveFiles(): ApprovalSnapshot["approvalSensitiveFiles"] {
  return getApprovalSensitiveFiles().map((filePath) => ({
    path: filePath,
    sha256: sha256File(filePath),
  }));
}

function checkApprovalSensitiveFilesExist(failures: string[]): void {
  for (const filePath of getApprovalSensitiveFiles()) {
    assertCondition(existsSync(repoPath(filePath)), `approval-sensitive file missing: ${filePath}`, failures);
  }
}

function checkAuthCompatibility(failures: string[]): void {
  const serverSource = readText("mcp_server/index.ts");
  const protectedActionsSource = readText("mcp_server/config/protectedActions.ts");
  const descriptors = summarizeMcpDescriptors().publicTools;

  for (const action of requiredProtectedActions) {
    assertCondition(protectedActionsSource.includes(`'${action}'`), `protected action missing from config: ${action}`, failures);
  }

  assertCondition(protectedActionsSource.includes("resolveActionAlias"), "protected action alias resolution is missing", failures);
  assertCondition(serverSource.includes("isProtectedAction(action) && !authenticatedUserId"), "HTTP protected-action auth gate is missing", failures);
  assertCondition(serverSource.includes("requiresAuth: true"), "auth-required response body marker is missing", failures);
  assertCondition(serverSource.includes("WWW-Authenticate"), "WWW-Authenticate auth challenge is missing", failures);
  assertCondition(serverSource.includes("authentication_required"), "authentication_required marker is missing", failures);
  assertCondition(serverSource.includes("OAuth token required"), "OAuth token required message is missing", failures);
  assertCondition(serverSource.includes('const UNAUTH_READONLY_TOOLS = new Set<string>(["search_activities"])'), "unauth read-only allowlist must remain search_activities only", failures);
  assertCondition(serverSource.includes("argsObj.userId = verifiedUserId"), "Auth-derived userId injection is missing", failures);

  assertCondition(
    stableStringify(descriptors.search_activities?.annotations ?? null) === stableStringify({ destructiveHint: false, openWorldHint: false, readOnlyHint: true }),
    "search_activities must remain read-only and non-destructive",
    failures
  );
  assertCondition(
    stableStringify(descriptors.register_for_activity?.annotations ?? null) === stableStringify({ destructiveHint: true, openWorldHint: false, readOnlyHint: false }),
    "register_for_activity must remain consequential/destructive and not read-only",
    failures
  );
}

function buildSnapshot(): ApprovalSnapshot {
  return {
    snapshotVersion: 1,
    publicTools: expectedPublicTools,
    manifest: summarizeManifest(),
    openapi: summarizeOpenApi(),
    mcpDescriptors: summarizeMcpDescriptors(),
    approvalSensitiveFiles: summarizeApprovalSensitiveFiles(),
  };
}

function assertSnapshotMatches(failures: string[]): void {
  assertCondition(existsSync(snapshotPath), `approval snapshot missing: ${path.relative(repoRoot, snapshotPath)}`, failures);
  if (!existsSync(snapshotPath)) return;

  const expected = JSON.parse(readFileSync(snapshotPath, "utf8")) as ApprovalSnapshot;
  const current = buildSnapshot();
  const expectedJson = stableStringify(expected as unknown as JsonValue);
  const currentJson = stableStringify(current as unknown as JsonValue);

  assertCondition(expectedJson === currentJson, "approval snapshot mismatch; inspect approval-sensitive files before updating snapshot", failures);
}

function runMode(mode: string): string[] {
  const failures: string[] = [];

  switch (mode) {
    case "manifest":
      checkManifest(failures);
      break;
    case "descriptors":
      checkDescriptors(failures);
      break;
    case "approval-snapshots":
      checkManifest(failures);
      checkOpenApi(failures);
      checkDescriptors(failures);
      checkAuthCompatibility(failures);
      checkApprovalSensitiveFilesExist(failures);
      assertSnapshotMatches(failures);
      break;
    case "all":
      checkManifest(failures);
      checkOpenApi(failures);
      checkDescriptors(failures);
      checkAuthCompatibility(failures);
      checkApprovalSensitiveFilesExist(failures);
      assertSnapshotMatches(failures);
      break;
    default:
      failures.push(`Unknown mode: ${mode}`);
  }

  return failures;
}

const mode = process.argv[2] ?? "all";

if (mode === "print-snapshot") {
  console.log(`${JSON.stringify(buildSnapshot(), null, 2)}\n`);
  process.exit(0);
}

if (mode === "write-snapshot") {
  writeFileSync(snapshotPath, `${JSON.stringify(buildSnapshot(), null, 2)}\n`);
  console.log(`Wrote ${path.relative(repoRoot, snapshotPath)}`);
  process.exit(0);
}

const failures = runMode(mode);

if (failures.length > 0) {
  console.error(`ChatGPT app guardrail check failed (${mode}):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ChatGPT app guardrail check passed (${mode}).`);
