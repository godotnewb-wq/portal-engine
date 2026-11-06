import type { Character } from '@engine/characters'
import { firstName } from '@engine/core'

export interface StageFigure {
  character: Character
  expression: string
  /** Has the current line. */
  speaking: boolean
  /** The placeholder's color, from the pack's species (setting.json) until sprites exist. */
  color?: string
}

/**
 * Who is here, standing side by side. While someone has the line they are lit and the others dimmed; during narration
 * nobody is (narrator-scene-engine §6, sprites). Placeholder figures until the art pipeline exists.
 */
export function SpriteStage({ figures }: { figures: StageFigure[] }) {
  const anyone = figures.some((f) => f.speaking)
  return (
    <div className="stage">
      {figures.map(({ character, expression, speaking, color }) => {
        const hue = color ?? '#9a8fab'
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
