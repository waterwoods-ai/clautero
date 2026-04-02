const MAX_MERGE_COUNT = 8;
const MAX_MERGE_CHARS = 12_000;

interface QueuedMessage {
  readonly text: string;
}

export interface MessageChannelOptions {
  readonly onSend: (ndjson: string) => Promise<void>;
  readonly onDrained?: () => void;
}

function formatStreamMessage(text: string): string {
  const message = { type: "user_message", content: text };
  return JSON.stringify(message) + "\n";
}

function mergeMessages(messages: readonly QueuedMessage[]): string {
  return messages.map((m) => m.text).join("\n\n---\n\n");
}

export function createMessageChannel(options: MessageChannelOptions) {
  let queue: readonly QueuedMessage[] = [];
  let inFlight = false;

  function canMerge(
    pending: readonly QueuedMessage[],
    next: QueuedMessage
  ): boolean {
    if (pending.length >= MAX_MERGE_COUNT) {
      return false;
    }

    const currentLength = pending.reduce((sum, m) => sum + m.text.length, 0);
    return currentLength + next.text.length <= MAX_MERGE_CHARS;
  }

  async function drainQueue(): Promise<void> {
    if (inFlight || queue.length === 0) {
      return;
    }

    inFlight = true;

    const toSend = queue;
    queue = [];

    const merged = mergeMessages(toSend);
    const ndjson = formatStreamMessage(merged);

    try {
      await options.onSend(ndjson);
    } catch (error) {
      inFlight = false;
      throw error;
    }
  }

  function enqueue(text: string): void {
    const message: QueuedMessage = { text };

    if (inFlight && queue.length > 0) {
      const lastIndex = queue.length - 1;
      const existing = queue[lastIndex];

      if (existing && canMerge(queue, message)) {
        queue = [...queue, message];
        return;
      }
    }

    queue = [...queue, message];

    if (!inFlight) {
      drainQueue().catch((error) => {
        throw error;
      });
    }
  }

  function markTurnComplete(): void {
    inFlight = false;

    if (queue.length === 0) {
      options.onDrained?.();
    } else {
      drainQueue().catch((error) => {
        throw error;
      });
    }
  }

  function pendingCount(): number {
    return queue.length;
  }

  function isInFlight(): boolean {
    return inFlight;
  }

  return { enqueue, markTurnComplete, pendingCount, isInFlight };
}
