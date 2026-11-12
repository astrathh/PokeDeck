import { useState } from 'react'

export function Welcome({ onSave }: { onSave(url: string): void }) {
  const [url, setUrl] = useState('')
  const valid = /^https?:\/\/\S+$/i.test(url.trim())
  return (
    <div className="welcome">
      <h1>Qual jogo o Deck vai abrir?</h1>
      <p className="muted">Cole a URL do jogo. Dá para trocar depois nas configurações.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) onSave(url.trim())
        }}
      >
        <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        <button className="primary" disabled={!valid}>
          Salvar
        </button>
      </form>
    </div>
  )
}
