/**
 * builtInCommands — Defines the built-in slash commands for Clautero.
 *
 * Each command is either a 'prompt' type (expands to a message string)
 * or an 'action' type (performs a side effect and returns null).
 */

export interface CommandContext {
  readonly currentContext: string;
  readonly clearConversation: () => void;
  // forkConversation: () => void;  // will be wired when Unit 9 is done
}

export interface SlashCommand {
  readonly name: string;
  readonly description: string;
  readonly type: "prompt" | "action";
  readonly execute: (args: string, context: CommandContext) => string | null;
}

function buildSummarizePrompt(): string {
  return (
    "Please provide a comprehensive summary of the following research paper, " +
    "highlighting key findings, methodology, and conclusions."
  );
}

function buildExplainPrompt(args: string): string {
  const topic = args.trim() || "the main concepts";
  return `In the context of the attached paper, please explain: ${topic}`;
}

function buildRelatedPrompt(): string {
  return (
    "Based on the attached paper's topic, methodology, and findings, " +
    "suggest related papers and research directions."
  );
}

function buildAnnotatePrompt(): string {
  return (
    "Please extract and organize the key annotations from the attached PDF, " +
    "grouping them by theme."
  );
}

function buildHelpText(commands: readonly SlashCommand[]): string {
  const lines = commands.map(
    (cmd) => `/${cmd.name} - ${cmd.description}`
  );
  return (
    "Available commands:\n\n" +
    lines.join("\n") +
    "\n\nType a command at the start of your message to use it."
  );
}

export const BUILT_IN_COMMANDS: readonly SlashCommand[] = Object.freeze([
  Object.freeze({
    name: "summarize",
    description: "Summarize the attached research paper",
    type: "prompt" as const,
    execute: () => buildSummarizePrompt(),
  }),
  Object.freeze({
    name: "explain",
    description: "Explain a concept in the context of the attached paper",
    type: "prompt" as const,
    execute: (args: string) => buildExplainPrompt(args),
  }),
  Object.freeze({
    name: "related",
    description: "Suggest related papers and research directions",
    type: "prompt" as const,
    execute: () => buildRelatedPrompt(),
  }),
  Object.freeze({
    name: "annotate",
    description: "Extract and organize key annotations by theme",
    type: "prompt" as const,
    execute: () => buildAnnotatePrompt(),
  }),
  Object.freeze({
    name: "clear",
    description: "Clear the current conversation",
    type: "action" as const,
    execute: (_args: string, context: CommandContext) => {
      context.clearConversation();
      return null;
    },
  }),
  Object.freeze({
    name: "help",
    description: "List all available commands",
    type: "prompt" as const,
    execute: () => buildHelpText(BUILT_IN_COMMANDS),
  }),
]);
