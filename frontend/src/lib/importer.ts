/** Open the "import a deck file" flow from anywhere (the dialog lives at the app root). */
export const IMPORT_EVENT = 'rounds:import'

export function openImport(): void {
  window.dispatchEvent(new Event(IMPORT_EVENT))
}
