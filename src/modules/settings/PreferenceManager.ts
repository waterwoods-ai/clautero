const PREF_PREFIX = "extensions.clautero."

interface ClauteroPreferences {
  claudeCliPath: string
  autoAttachContext: boolean
  sidebarWidth: number
  maxContextLength: number
  commandsDir: string
}

type PreferenceKey = keyof ClauteroPreferences

const PREF_KEYS: readonly PreferenceKey[] = [
  "claudeCliPath",
  "autoAttachContext",
  "sidebarWidth",
  "maxContextLength",
  "commandsDir",
] as const

function toPrefName(key: PreferenceKey): string {
  return `${PREF_PREFIX}${key}`
}

function getPreference<K extends PreferenceKey>(
  key: K
): ClauteroPreferences[K] {
  return Zotero.Prefs.get(toPrefName(key), true) as ClauteroPreferences[K]
}

function setPreference<K extends PreferenceKey>(
  key: K,
  value: ClauteroPreferences[K]
): void {
  Zotero.Prefs.set(toPrefName(key), value, true)
}

function getAllPreferences(): Readonly<ClauteroPreferences> {
  const prefs = PREF_KEYS.reduce((acc, key) => {
    return { ...acc, [key]: getPreference(key) }
  }, {} as ClauteroPreferences)

  return Object.freeze(prefs)
}

async function validateCliPath(path: string): Promise<boolean> {
  if (!path) {
    return false
  }
  try {
    return await IOUtils.exists(path)
  } catch (error) {
    Zotero.log(
      `[Clautero] Failed to validate CLI path "${path}": ${error}`,
      "warning"
    )
    return false
  }
}

function onPreferenceChanged(
  key: PreferenceKey,
  callback: () => void
): () => void {
  const prefName = toPrefName(key)
  const observer = {
    observe(_subject: unknown, topic: string, data: string) {
      if (topic === "nsPref:changed" && data === prefName) {
        callback()
      }
    },
  }

  const prefBranch = Components.classes[
    "@mozilla.org/preferences-service;1"
  ].getService(Components.interfaces.nsIPrefService)
    .getBranch("")

  prefBranch.addObserver(prefName, observer, false)

  return () => {
    prefBranch.removeObserver(prefName, observer)
  }
}

export {
  ClauteroPreferences,
  PreferenceKey,
  getPreference,
  setPreference,
  getAllPreferences,
  validateCliPath,
  onPreferenceChanged,
}
