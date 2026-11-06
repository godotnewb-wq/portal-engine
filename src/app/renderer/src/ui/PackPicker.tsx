import { useEffect, useState } from 'react'
import type { Pack } from '@engine/pack'
import type { PackListing } from '@platform/packs'
import { Button } from './Button'

const SOURCE: Record<PackListing['source'], string> = { bundled: 'Bundled', user: 'Installed', extra: 'Pack folder' }

/**
 * The first screen (architecture §10): every pack found, with its cover, name, version and description. Packs that
 * can't be played are shown greyed out with what's wrong, so a pack author can fix them; packs sharing an id are all
 * shown, with their folders, for the player to pick one.
 */
export function PackPicker({ onChosen, onSettings }: { onChosen: (pack: Pack) => void; onSettings: () => void }) {
  const [listings, setListings] = useState<PackListing[] | null>(null)
  const [message, setMessage] = useState('')

  const scan = () => {
    setListings(null)
    window.api.listPacks().then(setListings)
  }
  useEffect(scan, [])

  const choose = async (listing: PackListing) => {
    const response = await window.api.choosePack(listing.key)
    if (response.ok) onChosen(response.pack)
    else setMessage(response.error)
  }
  const openFolder = async () => setMessage(`Packs folder: ${await window.api.openPacksFolder()}`)

  return (
    <div className="screen picker">
      <h1 className="logo">Portal Engine</h1>
      <p className="tagline">Choose a game</p>
      <div className="packs">
        {listings === null
          ? 'Looking for packs…'
          : listings.length === 0
            ? 'No packs found. Open the packs folder and put a pack in it.'
            : listings.map((l) => {
                const name = l.manifest?.name ?? l.key.split(/[\\/]/).pop()
                return (
                  <article key={l.key} className={['pack', !l.ok && 'broken'].filter(Boolean).join(' ')}>
                    <div className="pack-cover">{l.cover ? <img src={l.cover} alt="" /> : <span>{name?.[0]}</span>}</div>
                    <div className="pack-text">
                      <header>
                        <h2>{name}</h2>
                        {l.manifest && <span className="pack-version">v{l.manifest.version}</span>}
                        <span className="pack-source">{SOURCE[l.source]}</span>
                      </header>
                      {l.manifest?.description && <p>{l.manifest.description}</p>}
                      {l.manifest?.content.rating && <p className="pack-rating">{l.manifest.content.rating}</p>}
                      {l.duplicate && <p className="pack-duplicate">Another folder has a pack with the same id. This one is in {l.key}</p>}
                      {!l.ok && (
                        <details className="pack-problems" open>
                          <summary>Can't be played: {l.problems.length} problem{l.problems.length === 1 ? '' : 's'}</summary>
                          <ul>
                            {l.problems.map((p) => (
                              <li key={p}>{p}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                    <Button variant="primary" disabled={!l.ok} onClick={() => choose(l)}>
                      Play
                    </Button>
                  </article>
                )
              })}
      </div>
      <div className="row">
        <Button onClick={openFolder}>Open packs folder</Button>
        <Button onClick={scan}>Look again</Button>
        <Button variant="ghost" onClick={onSettings}>
          Settings
        </Button>
        {message && <span className="status">{message}</span>}
      </div>
    </div>
  )
}
