import type { SlotDeclaration } from '@pascal-app/core'

export const PANEL_SLOT_ID = 'surface'

/** A panel has one paintable part: its face. */
export function panelSlots(): SlotDeclaration[] {
  return [{ slotId: PANEL_SLOT_ID, label: 'Surface' }]
}
