import type { TurnTrace } from '@engine/scene'

/**
 * The quality rubric (milestone 2, B1), as the scorer and the tools see it. People rate the same items 1–5 on a
 * sample of turns. Worded for any game: a pack's tone file and character cards say what each item means in its world.
 */
export interface RubricItem {
  id: number
  part: 'director' | 'writer'
  /** Short name, for tables. */
  name: string
  /** What a 5 looks like. */
  text: string
  /**
   * What a 5 looks like on a `scene`-pipeline turn, for an item that reads the director's plan (Milestone 5 task 6):
   * that plan has a moment for each person in focus, pressures and stakes in place of speakers, moves and texture.
   */
  scene?: string
  /** Whether the item can be judged on this turn; most always can. */
  applies?: (turn: ScorableTurn) => boolean
}

/** What any reviewer of a turn reads: what the player did, the plan and its rolls, the beats as shown, who was there. */
export type ScorableTurn = Pick<TurnTrace, 'turnId' | 'turn' | 'input' | 'checks' | 'beats'> & {
  director: Pick<TurnTrace['director'], 'plan'>
  cast: Pick<TurnTrace['cast'], 'before'>
}

const hasChecks = (t: ScorableTurn) => t.checks.length > 0
const isScene = (t: ScorableTurn) => !!t.director.plan.scene
const hasSecret = (t: ScorableTurn) => t.director.plan.speakers.some((s) => (s.hiding ?? '').trim().length > 0)
const notFirst = (t: ScorableTurn) => t.turn > 1

export const RUBRIC: RubricItem[] = [
  { id: 1, part: 'director', name: 'speaker choice', text: 'Speakers follow the priority rules: whoever was addressed, an urgent agenda, low comfort, longest silent.', scene: 'Focus follows the priority rules: whoever was addressed, an urgent agenda, low comfort, longest silent.' },
  { id: 2, part: 'director', name: 'focus rotation', text: 'Focus rotates across turns; nobody fades out.', applies: notFirst },
  { id: 3, part: 'director', name: 'check fit', text: 'Checks fit the input: the right skill and a sensible difficulty.', applies: hasChecks },
  { id: 4, part: 'director', name: 'own agendas', text: "Speakers' intents come from their own agendas, not only from reacting to the player.", scene: 'What each person in focus wants comes from their own agendas, not only from reacting to the player.' },
  { id: 5, part: 'director', name: 'secrets', text: 'A secret is handled with a fitting approach (lie, deflect, partial truth) and its tell.', applies: hasSecret },
  { id: 6, part: 'director', name: 'usable plan', text: 'The plan itself, not the prose: texture, contrast and avoid fields are specific and usable.', scene: "The plan itself, not the prose: each moment says plainly how what happened lands and what the person wants now; the pressures fit what touched them; the stakes name what could change." },
  { id: 7, part: 'writer', name: 'second person', text: 'Second person throughout; never speaks, decides or acts for the player beyond their input.' },
  { id: 8, part: 'writer', name: 'who speaks', text: 'Only planned speakers talk; reactions stay reactions.', scene: 'The people in focus carry the scene. Anyone else present may react or say a little, as the scene plan allows; only someone not present, or a walk-on not listed, speaking counts against it.' },
  { id: 9, part: 'writer', name: 'checks honored', text: 'Check results are honored exactly: a failed roll does not happen.', applies: hasChecks },
  { id: 10, part: 'writer', name: 'distinct voices', text: 'Each speaker sounds like their voice card and no one else.' },
  { id: 11, part: 'writer', name: 'rooted texture', text: 'Texture is rooted in this setting and location, not generic genre filler.' },
  { id: 12, part: 'writer', name: 'subtext', text: 'Subtext over stated emotion; consequences over adjectives.' },
  { id: 13, part: 'writer', name: 'no repetition', text: 'No repeated phrases, gestures or details from earlier turns.', applies: notFirst },
  { id: 14, part: 'writer', name: 'pacing', text: 'Beat count and length within budget; each beat earns its place.', scene: 'Length within the guide (about 4 to 6 paragraphs, marked ¶); each paragraph earns its place.' },
  { id: 15, part: 'writer', name: 'tone', text: "The tone matches the pack's tone." },
  // Milestone 5 (scene system redesign §11; writing quality, "Future items"), with scorer version 2.
  { id: 16, part: 'writer', name: 'in the moment', text: 'What each character says comes first from what just happened: what was said to them, who is there, how they feel right now.' },
  { id: 17, part: 'writer', name: 'responds to meaning', text: 'Each line answers what the one before it meant, not only its words; the turn reads as one conversation, not separate statements.' },
  { id: 18, part: 'writer', name: 'undercurrent', text: 'Goals and secrets shape what a character chooses, avoids or notices, rather than being announced or filling every line.' }
]

/** What a 5 looks like for an item on this turn: its scene wording on a `scene`-pipeline turn, where it has one. */
export const itemText = (item: RubricItem, turn: ScorableTurn): string => (isScene(turn) && item.scene) || item.text

/** The rubric items that can be judged on a turn. */
export const itemsFor = (turn: ScorableTurn): RubricItem[] => RUBRIC.filter((i) => !i.applies || i.applies(turn))
