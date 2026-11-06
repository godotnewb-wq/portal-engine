// Adapted from Breedhaven University, src/main/saves/store.ts (GPL-3.0-only). See NOTICE.md.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GameState } from '@engine/state'
import { SaveFileSchema, SAVE_VERSION, SLOT_IDS, slotLabel, type SaveFile, type SavePack, type SaveSummary, type SlotId } from '@engine/state'

/**
 * Stores each save slot as one JSON file in a directory: one directory per pack (architecture §9). Saves record the
 * pack's id and version; a save from another pack is refused. One from another version of this pack is returned, and
 * the caller checks it still fits the pack's content.
 */
export class SaveStore {
  constructor(
    private readonly dir: string,
    private readonly pack: SavePack
  ) {}

  list(): SaveSummary[] {
    return SLOT_IDS.flatMap((slotId): SaveSummary[] => {
      const path = this.path(slotId)
      if (!existsSync(path)) return []
      try {
        return [summarize(slotId, this.read(path))]
      } catch {
        return [{ slotId, savedAt: statSync(path).mtime.toISOString(), unreadable: true }]
      }
    })
  }

  /** Writes a game to a slot. With no name given, one written over another keeps the name the other had. */
  save(slotId: SlotId, state: GameState, now = new Date(), name?: string): SaveSummary {
    const kept = name ?? this.nameOf(slotId)
    const file: SaveFile = { version: SAVE_VERSION, pack: this.pack, savedAt: now.toISOString(), ...(kept ? { name: kept } : {}), state }
    mkdirSync(this.dir, { recursive: true })
    // Write to a temporary file first so a crash mid-write can't destroy the existing save.
    const path = this.path(slotId)
    writeFileSync(`${path}.tmp`, JSON.stringify(file))
    renameSync(`${path}.tmp`, path)
    return summarize(slotId, file)
  }

  load(slotId: SlotId): GameState {
    const path = this.path(slotId)
    if (!existsSync(path)) throw new Error(`${slotLabel(slotId)} is empty`)
    let file: SaveFile
    try {
      file = this.read(path)
    } catch {
      throw new Error(`${slotLabel(slotId)} could not be read`)
    }
    if (file.pack.id !== this.pack.id) throw new Error(`${slotLabel(slotId)} belongs to the pack "${file.pack.id}"`)
    return file.state
  }

  delete(slotId: SlotId): void {
    rmSync(this.path(slotId), { force: true })
  }

  private nameOf(slotId: SlotId): string | undefined {
    try {
      return existsSync(this.path(slotId)) ? this.read(this.path(slotId)).name : undefined
    } catch {
      return undefined
    }
  }

  private path(slotId: SlotId): string {
    return join(this.dir, `${slotId}.json`)
  }

  private read(path: string): SaveFile {
    return SaveFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  }
}

function summarize(slotId: SlotId, file: SaveFile): SaveSummary {
  return {
    slotId,
    savedAt: file.savedAt,
    unreadable: false,
    ...(file.name ? { name: file.name } : {}),
    packVersion: file.pack.version,
    playerName: file.state.player.name,
    time: file.state.time,
    inScene: file.state.scene !== null,
    turns: file.state.scene?.turns.length ?? 0,
    memories: file.state.memories.length
  }
}
