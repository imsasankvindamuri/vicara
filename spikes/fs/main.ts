// Folder test: checks whether vicara can keep its notes as real .md files
// in a folder the user picks, on this phone's browser.
//
// Only the folder handle is stored (in IndexedDB) so the folder can be
// reopened later. No note content is stored anywhere except the folder.

const logEl = document.querySelector<HTMLDivElement>('#log')!
const folderEl = document.querySelector<HTMLDivElement>('#folder')!

let dir: FileSystemDirectoryHandle | null = null

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

type Level = 'pass' | 'fail' | 'info' | 'plain'

function log(message: string, level: Level = 'plain'): void {
  const line = document.createElement('div')
  const prefix = { pass: 'PASS ', fail: 'FAIL ', info: '···· ', plain: '' }[level]
  line.textContent = prefix + message
  if (level !== 'plain') line.className = level
  logEl.append(line)
  line.scrollIntoView({ block: 'end' })
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

// ---------------------------------------------------------------------------
// Saved folder handle (IndexedDB holds the handle only)
// ---------------------------------------------------------------------------

const DB_NAME = 'vicara-fs-test'
const STORE = 'handles'
const KEY = 'folder'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function saveHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(handle, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function loadHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  const db = await openDb()
  const handle = await new Promise<FileSystemDirectoryHandle | undefined>((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(KEY)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return handle
}

function setFolder(handle: FileSystemDirectoryHandle): void {
  dir = handle
  folderEl.textContent = `Folder: ${handle.name}`
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

async function writeFile(
  parent: FileSystemDirectoryHandle,
  name: string,
  content: string,
): Promise<FileSystemFileHandle> {
  const file = await parent.getFileHandle(name, { create: true })
  const writable = await file.createWritable()
  await writable.write(content)
  await writable.close()
  return file
}

async function readFile(parent: FileSystemDirectoryHandle, name: string): Promise<string> {
  const file = await parent.getFileHandle(name)
  return (await file.getFile()).text()
}

async function exists(parent: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await parent.getFileHandle(name)
    return true
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return false
    throw error
  }
}

async function listNames(parent: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = []
  for await (const entry of parent.values()) names.push(entry.name)
  return names
}

// Collects entries first so the folder isn't modified while being iterated.
async function collect(iterator: AsyncIterableIterator<FileSystemHandle>): Promise<FileSystemHandle[]> {
  const entries: FileSystemHandle[] = []
  for await (const entry of iterator) entries.push(entry)
  return entries
}

// Recursive removeEntry() fails on Android, so empty the folder first.
async function removeDirManually(parent: FileSystemDirectoryHandle, name: string): Promise<void> {
  const sub = await parent.getDirectoryHandle(name)
  for (const entry of await collect(sub.values())) {
    if (entry.kind === 'directory') await removeDirManually(sub, entry.name)
    else await sub.removeEntry(entry.name)
  }
  await parent.removeEntry(name)
}

// Removes a folder, falling back to the manual method. Returns which one worked.
async function removeDir(parent: FileSystemDirectoryHandle, name: string): Promise<string> {
  try {
    await parent.removeEntry(name, { recursive: true })
    return 'recursive delete works'
  } catch (error) {
    await removeDirManually(parent, name)
    return `recursive delete failed (${errorText(error)}); manual delete works`
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const PREFIX = 'vicara-test-'
const SUBDIR = `${PREFIX}subfolder`
const SLOW_FILE = `${PREFIX}slow-write.md`
const SLOW_OLD = '# OLD\n\nThis is the complete old version of the file.\n'
const SLOW_CHUNKS = 20

type Test = [name: string, run: (root: FileSystemDirectoryHandle) => Promise<string | void>]

const tests: Test[] = [
  ['Write a new .md file and read it back', async (root) => {
    const content = '# Hello\n\nFirst entry.\n'
    await writeFile(root, `${PREFIX}basic.md`, content)
    const read = await readFile(root, `${PREFIX}basic.md`)
    if (read !== content) throw new Error(`read back ${JSON.stringify(read)}`)
  }],

  ['Unicode round trip (Devanagari, emoji, accents)', async (root) => {
    const content = '# विचार\n\nFeeling 🌧️ today… café, naïve, “quotes”.\n'
    await writeFile(root, `${PREFIX}unicode.md`, content)
    const read = await readFile(root, `${PREFIX}unicode.md`)
    if (read !== content) throw new Error(`read back ${JSON.stringify(read)}`)
  }],

  ['Overwrite with shorter content (no leftover bytes)', async (root) => {
    await writeFile(root, `${PREFIX}overwrite.md`, 'A much longer original version of this entry.\n')
    await writeFile(root, `${PREFIX}overwrite.md`, 'Short.\n')
    const read = await readFile(root, `${PREFIX}overwrite.md`)
    if (read !== 'Short.\n') throw new Error(`read back ${JSON.stringify(read)}`)
  }],

  ['Append to an existing file', async (root) => {
    const file = await writeFile(root, `${PREFIX}append.md`, 'Line one.\n')
    const size = (await file.getFile()).size
    const writable = await file.createWritable({ keepExistingData: true })
    await writable.seek(size)
    await writable.write('Line two.\n')
    await writable.close()
    const read = await readFile(root, `${PREFIX}append.md`)
    if (read !== 'Line one.\nLine two.\n') throw new Error(`read back ${JSON.stringify(read)}`)
  }],

  ['Create a subfolder and write inside it', async (root) => {
    const sub = await root.getDirectoryHandle(SUBDIR, { create: true })
    await writeFile(sub, 'inside.md', 'Nested.\n')
    const read = await readFile(sub, 'inside.md')
    if (read !== 'Nested.\n') throw new Error(`read back ${JSON.stringify(read)}`)
  }],

  ['List the folder', async (root) => {
    const names = await listNames(root)
    for (const expected of [`${PREFIX}basic.md`, SUBDIR]) {
      if (!names.includes(expected)) throw new Error(`missing ${expected}; saw ${names.join(', ')}`)
    }
    return `${names.length} entries`
  }],

  ['Rename a file', async (root) => {
    const oldName = `${PREFIX}rename-old.md`
    const newName = `${PREFIX}rename-new.md`
    const file = await writeFile(root, oldName, 'Rename me.\n')
    let method = 'move() works'
    try {
      if (typeof file.move !== 'function') throw new Error('move() not available')
      await file.move(newName)
    } catch (error) {
      // Fallback: copy to the new name, verify, then delete the original.
      await writeFile(root, newName, await readFile(root, oldName))
      await root.removeEntry(oldName)
      method = `move() failed (${errorText(error)}); copy + delete works`
    }
    if (await exists(root, oldName)) throw new Error('old name still exists')
    const read = await readFile(root, newName)
    if (read !== 'Rename me.\n') throw new Error(`read back ${JSON.stringify(read)}`)
    return method
  }],

  ['Delete a file', async (root) => {
    await writeFile(root, `${PREFIX}delete.md`, 'Delete me.\n')
    await root.removeEntry(`${PREFIX}delete.md`)
    if (await exists(root, `${PREFIX}delete.md`)) throw new Error('file still exists')
  }],

  ['Write 50 small files (speed)', async (root) => {
    const sub = await root.getDirectoryHandle(SUBDIR, { create: true })
    const start = performance.now()
    for (let i = 0; i < 50; i++) await writeFile(sub, `note-${i}.md`, `Note ${i}\n`)
    const writeMs = performance.now() - start
    const listStart = performance.now()
    const count = (await listNames(sub)).length
    const listMs = performance.now() - listStart
    return `writes ${writeMs.toFixed(0)} ms total, list of ${count} in ${listMs.toFixed(0)} ms`
  }],

  ['Write and read a 200 KB entry (speed)', async (root) => {
    const content = 'All work and no play makes a very long diary entry.\n'.repeat(4000)
    const start = performance.now()
    await writeFile(root, `${PREFIX}large.md`, content)
    const writeMs = performance.now() - start
    const readStart = performance.now()
    const read = await readFile(root, `${PREFIX}large.md`)
    const readMs = performance.now() - readStart
    if (read !== content) throw new Error('content mismatch')
    return `${(content.length / 1024).toFixed(0)} KB: write ${writeMs.toFixed(0)} ms, read ${readMs.toFixed(0)} ms`
  }],

  ['Delete the test subfolder', async (root) => {
    const method = await removeDir(root, SUBDIR)
    const names = await listNames(root)
    if (names.includes(SUBDIR)) throw new Error('subfolder still exists')
    return method
  }],

  ['Clean up remaining test files', async (root) => {
    let removed = 0
    for (const entry of await collect(root.values())) {
      if (!entry.name.startsWith(PREFIX) || entry.name === SLOW_FILE) continue
      if (entry.kind === 'directory') await removeDir(root, entry.name)
      else await root.removeEntry(entry.name)
      removed++
    }
    return `removed ${removed}`
  }],
]

async function runAll(): Promise<void> {
  if (!dir) return log('Pick a folder first.', 'fail')
  log(`Running ${tests.length} tests in "${dir.name}"…`, 'info')
  let passed = 0
  for (const [name, run] of tests) {
    try {
      const detail = await run(dir)
      log(detail ? `${name} (${detail})` : name, 'pass')
      passed++
    } catch (error) {
      log(`${name}: ${errorText(error)}`, 'fail')
    }
  }
  log(`${passed}/${tests.length} passed.`, passed === tests.length ? 'pass' : 'fail')
}

// ---------------------------------------------------------------------------
// Kill-during-write test: are writes atomic on this phone?
// ---------------------------------------------------------------------------

async function slowWrite(): Promise<void> {
  if (!dir) return log('Pick a folder first.', 'fail')
  await writeFile(dir, SLOW_FILE, SLOW_OLD)
  log('Wrote the OLD version. Starting a 20-second write of the NEW version…', 'info')
  log('Swipe vicara away from recent apps in the next ~15 seconds, then reopen ' +
    'this page, tap "Reconnect saved folder", then "Check slow-write file".', 'info')

  const file = await dir.getFileHandle(SLOW_FILE)
  const writable = await file.createWritable()
  for (let i = 1; i <= SLOW_CHUNKS; i++) {
    await writable.write(`NEW chunk ${String(i).padStart(2, '0')} of ${SLOW_CHUNKS}\n`)
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  await writable.close()
  log('Slow write finished without interruption (the app was not killed).', 'info')
}

async function checkSlowWrite(): Promise<void> {
  if (!dir) return log('Pick or reconnect the folder first.', 'fail')
  if (!(await exists(dir, SLOW_FILE))) return log('No slow-write file found.', 'fail')
  const content = await readFile(dir, SLOW_FILE)
  const chunks = content.match(/^NEW chunk/gm)?.length ?? 0

  if (content === SLOW_OLD) {
    log('File still has the complete OLD version: interrupted writes are atomic here.', 'pass')
  } else if (chunks === SLOW_CHUNKS) {
    log('File has the complete NEW version (the write finished).', 'pass')
  } else if (content.length === 0) {
    log('File is EMPTY: an interrupted write destroys the old content.', 'fail')
  } else {
    log(`File is PARTIAL (${chunks}/${SLOW_CHUNKS} new chunks): interrupted writes are not atomic.`, 'fail')
  }
  log(`Contents:\n${content}`)
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

async function envInfo(): Promise<void> {
  const standalone = matchMedia('(display-mode: standalone)').matches
  log(`User agent: ${navigator.userAgent}`, 'info')
  log(`Secure context: ${isSecureContext}`, 'info')
  log(`showDirectoryPicker available: ${typeof window.showDirectoryPicker === 'function'}`, 'info')
  log(`Running as installed app: ${standalone}`, 'info')
  log(`Cross-origin isolated: ${crossOriginIsolated}`, 'info')
  log(`navigator.deviceMemory: ${navigator.deviceMemory ?? 'unavailable'} GB`, 'info')
  log(`CPU threads (hardwareConcurrency): ${navigator.hardwareConcurrency}`, 'info')
  if (navigator.storage) {
    log(`Storage persisted: ${await navigator.storage.persisted()}`, 'info')
  }
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

function on(id: string, handler: () => Promise<void> | void): void {
  document.querySelector(`#${id}`)!.addEventListener('click', async () => {
    try {
      await handler()
    } catch (error) {
      log(errorText(error), 'fail')
    }
  })
}

on('pick', async () => {
  if (typeof window.showDirectoryPicker !== 'function') {
    return log('showDirectoryPicker is not available in this browser.', 'fail')
  }
  const handle = await window.showDirectoryPicker({ id: 'vicara', mode: 'readwrite' })
  setFolder(handle)
  await saveHandle(handle)
  log(`Picked "${handle.name}" and saved the handle.`, 'pass')
})

on('restore', async () => {
  const handle = await loadHandle()
  if (!handle) return log('No saved folder. Pick one first.', 'fail')
  let state = await handle.queryPermission({ mode: 'readwrite' })
  log(`Saved folder "${handle.name}": permission is "${state}" before asking.`, 'info')
  if (state !== 'granted') {
    state = await handle.requestPermission({ mode: 'readwrite' })
    log(`After asking: "${state}".`, state === 'granted' ? 'pass' : 'fail')
  }
  if (state === 'granted') setFolder(handle)
})

on('run', runAll)
on('slow', slowWrite)
on('check-slow', checkSlowWrite)
on('env', envInfo)
on('clear', () => logEl.replaceChildren())
on('copy', async () => {
  const text = logEl.innerText
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text)
  } else {
    // navigator.clipboard only exists on secure pages; use the legacy method.
    const area = document.createElement('textarea')
    area.value = text
    document.body.append(area)
    area.select()
    const copied = document.execCommand('copy')
    area.remove()
    if (!copied) return log('Copy failed. Select the log text by hand.', 'fail')
  }
  log('Log copied to clipboard.', 'info')
})

void envInfo()
