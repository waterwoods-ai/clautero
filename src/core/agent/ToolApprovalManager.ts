import type { ToolApprovalResult, ToolRequest } from "./types";

const READ_TOOLS: ReadonlySet<string> = new Set([
  "Read",
  "Glob",
  "Grep",
  "LSP",
]);

const SENSITIVE_PATH_PATTERNS: readonly RegExp[] = [
  /\.env($|\.)/,
  /credentials\./,
  /\.ssh\//,
  /\.gnupg\//,
  /\/etc\/shadow/,
  /\/etc\/passwd/,
  /\.aws\//,
  /\.npmrc$/,
  /\.pypirc$/,
  /id_rsa/,
  /id_ed25519/,
];

function isReadOperation(toolName: string): boolean {
  return READ_TOOLS.has(toolName);
}

function isSensitivePath(filePath: string): boolean {
  return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

function isWithinAllowedPaths(
  filePath: string,
  allowedPaths: readonly string[]
): boolean {
  return allowedPaths.some(
    (allowed) =>
      filePath === allowed || filePath.startsWith(allowed + "/")
  );
}

function extractFilePath(args: Readonly<Record<string, unknown>>): string | null {
  const candidates = ["file_path", "path", "filePath", "file"];

  for (const key of candidates) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return null;
}

function formatToolDescription(request: ToolRequest): string {
  const filePath = extractFilePath(request.args);
  const pathSuffix = filePath ? ` on "${filePath}"` : "";
  return `${request.toolName}${pathSuffix}`;
}

async function promptUser(request: ToolRequest): Promise<ToolApprovalResult> {
  try {
    const description = formatToolDescription(request);
    const message = `Claude wants to use: ${description}\n\nAllow this operation?`;

    const { Services: GeckoServices } = ChromeUtils.importESModule(
      "resource://gre/modules/Services.sys.mjs"
    ) as {
      Services: {
        prompt: {
          confirm: (
            parent: null,
            title: string,
            message: string
          ) => boolean;
        };
      };
    };

    const confirmed = GeckoServices.prompt.confirm(
      null,
      "Clautero - Tool Approval",
      message
    );

    return confirmed ? "approve" : "deny";
  } catch (error) {
    Zotero.log(
      `[Clautero] Tool approval prompt failed: ${error}`,
      "warning"
    );
    return "deny";
  }
}

export async function evaluate(
  request: ToolRequest,
  allowedPaths: readonly string[]
): Promise<ToolApprovalResult> {
  const filePath = extractFilePath(request.args);

  // Deny operations on sensitive paths regardless of tool type
  if (filePath && isSensitivePath(filePath)) {
    Zotero.log(
      `[Clautero] Denied ${request.toolName} on sensitive path: ${filePath}`,
      "warning"
    );
    return "deny";
  }

  // Deny operations on paths outside the workspace
  if (filePath && !isWithinAllowedPaths(filePath, allowedPaths)) {
    Zotero.log(
      `[Clautero] Denied ${request.toolName} outside allowed paths: ${filePath}`,
      "warning"
    );
    return "deny";
  }

  // Auto-approve read operations on allowed paths
  if (isReadOperation(request.toolName)) {
    return "approve";
  }

  // Prompt user for write/edit/bash operations
  return promptUser(request);
}
