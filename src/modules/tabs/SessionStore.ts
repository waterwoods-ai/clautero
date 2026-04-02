/**
 * SessionStore -- Persists session metadata to the filesystem.
 *
 * Each session is stored as a JSON file under <zotero-data>/clautero/sessions/.
 * All functions are pure/async; no mutable module-level state.
 */

export interface SessionMetadata {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly claudeSessionId?: string;
  readonly linkedItemKeys: readonly string[];
}

function getSessionsDir(): string {
  return PathUtils.join(Zotero.DataDirectory.dir, "clautero", "sessions");
}

function sessionFilePath(id: string): string {
  return PathUtils.join(getSessionsDir(), `${id}.json`);
}

async function ensureSessionsDir(): Promise<void> {
  const dir = getSessionsDir();
  await IOUtils.makeDirectory(dir, { ignoreExisting: true });
}

export async function saveSession(session: SessionMetadata): Promise<void> {
  await ensureSessionsDir();
  const filePath = sessionFilePath(session.id);
  const data = {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    claudeSessionId: session.claudeSessionId ?? null,
    linkedItemKeys: [...session.linkedItemKeys],
  };
  await IOUtils.writeJSON(filePath, data);
}

export async function loadSession(
  id: string
): Promise<SessionMetadata | null> {
  const filePath = sessionFilePath(id);
  try {
    const data = await IOUtils.readJSON(filePath);
    return Object.freeze({
      id: String(data.id),
      title: String(data.title),
      createdAt: Number(data.createdAt),
      updatedAt: Number(data.updatedAt),
      claudeSessionId: data.claudeSessionId
        ? String(data.claudeSessionId)
        : undefined,
      linkedItemKeys: Object.freeze(
        Array.isArray(data.linkedItemKeys)
          ? data.linkedItemKeys.map(String)
          : []
      ),
    });
  } catch (error) {
    Zotero.log(
      `[Clautero] Failed to load session ${id}: ${error}`,
      "warning"
    );
    return null;
  }
}

export async function listSessions(): Promise<readonly SessionMetadata[]> {
  await ensureSessionsDir();
  const dir = getSessionsDir();

  let entries: string[];
  try {
    entries = await IOUtils.getChildren(dir);
  } catch {
    return Object.freeze([]);
  }

  const jsonFiles = entries.filter((entry) => entry.endsWith(".json"));
  const sessions: SessionMetadata[] = [];

  for (const filePath of jsonFiles) {
    try {
      const data = await IOUtils.readJSON(filePath);
      sessions.push(
        Object.freeze({
          id: String(data.id),
          title: String(data.title),
          createdAt: Number(data.createdAt),
          updatedAt: Number(data.updatedAt),
          claudeSessionId: data.claudeSessionId
            ? String(data.claudeSessionId)
            : undefined,
          linkedItemKeys: Object.freeze(
            Array.isArray(data.linkedItemKeys)
              ? data.linkedItemKeys.map(String)
              : []
          ),
        })
      );
    } catch (error) {
      Zotero.log(
        `[Clautero] Skipping corrupt session file ${filePath}: ${error}`,
        "warning"
      );
    }
  }

  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  return Object.freeze(sessions);
}

export async function deleteSession(id: string): Promise<void> {
  const filePath = sessionFilePath(id);
  try {
    await IOUtils.remove(filePath, { ignoreAbsent: true });
  } catch (error) {
    Zotero.log(
      `[Clautero] Failed to delete session ${id}: ${error}`,
      "warning"
    );
  }
}
