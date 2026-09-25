// Parts of the File System Access API that TypeScript's DOM types don't include.

type FsPermissionMode = 'read' | 'readwrite'

interface FileSystemHandle {
  queryPermission(options?: { mode?: FsPermissionMode }): Promise<PermissionState>
  requestPermission(options?: { mode?: FsPermissionMode }): Promise<PermissionState>
}

interface FileSystemFileHandle {
  // Chrome-only; not in every browser.
  move?(newName: string): Promise<void>
  move?(destination: FileSystemDirectoryHandle, newName?: string): Promise<void>
}

interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>
}

interface Window {
  showDirectoryPicker?(options?: {
    id?: string
    mode?: FsPermissionMode
    startIn?: string
  }): Promise<FileSystemDirectoryHandle>
}

interface Navigator {
  deviceMemory?: number
}
