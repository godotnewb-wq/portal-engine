import type { Character } from '@engine/characters'
import { firstName } from '@engine/core'

/** Placeholder colors by species until sprites are generated; each reads at a glance on the dark stage. */
const SPECIES_HUE: Record<string, string> = {
  human: '#8f8aa3',
  'light-elf': '#d8b55a',
  'dark-elf': '#3ec9c2',
  goblin: '#7fbf5a',
  golem: '#c9773e'
}

export interface StageFigure {
  character: Character
  expression: string
  /** Has the current line. */
  speaking: boolean
}

/**
 * Who is here, standing side by side. While someone has the line they are lit and the others dimmed; during narration
 * nobody is (narrator-scene-engine §6, sprites). Placeholder figures until the art pipeline exists.
 */
export function SpriteStage({ figures }: { figures: StageFigure[] }) {
  const anyone = figures.some((f) => f.speaking)
  return (
    <div className="stage">
      {figures.map(({ character, expression, speaking }) => {
        const hue = SPECIES_HUE[character.species] ?? '#9a8fab'
        const dim = anyone && !speaking
        return (
          <div key={character.id} className={['figure', speaking && 'speaking', dim && 'dim'].filter(Boolean).join(' ')} style={{ ['--hue' as string]: hue }}>
            {character.sprite ? (
              <img src={character.sprite} alt={character.name} />
            ) : (
              <div className="silhouette" title={character.appearance}>
                <div className="head" />
                <div className="body" />
              </div>
            )}
            <div className="figure-label">
              <span>{firstName(character.name)}</span>
              <small>{expression}</small>
            </div>
          </div>
        )
      })}
    </div>
  )
}
