/**
 * SlashCommandParser — Parses and resolves slash commands from user input.
 *
 * Detects `/command` at the start of input, looks up the matching SlashCommand,
 * and expands prompt-type commands or runs action-type commands.
 */

import type { SlashCommand, CommandContext } from "./builtInCommands";

interface ParsedCommand {
  readonly command: string;
  readonly args: string;
}

const SLASH_COMMAND_PATTERN = /^\/(\w+)\s*(.*)/;

/**
 * Parse a slash command from the beginning of the input text.
 * Returns the command name and arguments, or null if no command found.
 */
export function parse(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const match = SLASH_COMMAND_PATTERN.exec(trimmed);
  if (!match) {
    return null;
  }

  return Object.freeze({
    command: match[1],
    args: match[2].trim(),
  });
}

/**
 * Look up a command by name from a list of available commands.
 * Returns the matching SlashCommand or null if not found.
 */
export function findCommand(
  name: string,
  commands: readonly SlashCommand[]
): SlashCommand | null {
  const lower = name.toLowerCase();
  return commands.find((cmd) => cmd.name.toLowerCase() === lower) ?? null;
}

/**
 * Run a command and return the expanded prompt text.
 * Returns the prompt string for 'prompt' commands, or null for 'action' commands.
 */
export function expandCommand(
  command: SlashCommand,
  args: string,
  context: CommandContext
): string | null {
  try {
    return command.execute(args, context);
  } catch (error) {
    Zotero.log(
      `[Clautero] Failed to run command /${command.name}: ${error}`,
      "warning"
    );
    return null;
  }
}

/**
 * Filter commands whose names start with the given prefix.
 * Used by the dropdown to narrow suggestions as the user types.
 */
export function filterCommands(
  prefix: string,
  commands: readonly SlashCommand[]
): readonly SlashCommand[] {
  const lower = prefix.toLowerCase();
  if (!lower) {
    return commands;
  }
  return commands.filter((cmd) => cmd.name.toLowerCase().startsWith(lower));
}
