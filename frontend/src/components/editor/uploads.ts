import type { AnkiBackend } from '../../backend/AnkiBackend'
import { BackendError } from '../../backend/AnkiBackend'

interface UploadMessage {
  id: string
  name: string
  mime: string
  data: ArrayBuffer
}

/**
 * A file pasted or dropped into the (sandboxed) field editor: save it to the
 * media folder and tell the editor the file's final name.
 * Resolves with an error message, or null on success.
 */
export async function handleEditorUpload(
  backend: AnkiBackend,
  frame: HTMLIFrameElement | null,
  msg: UploadMessage,
): Promise<string | null> {
  const reply = (body: object) => frame?.contentWindow?.postMessage({ type: 'uploaded', id: msg.id, ...body }, '*')
  try {
    const filename = await backend.uploadMedia(msg.name, new Blob([msg.data], { type: msg.mime }))
    reply({ filename })
    return null
  } catch (err) {
    reply({ error: true })
    return err instanceof BackendError ? err.message : 'Couldn’t add that file.'
  }
}
