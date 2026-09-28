import { useEffect, useRef, useState } from 'react'
import { Circle, Download, Eraser, Music2, Paintbrush, RotateCcw, Trash2 } from 'lucide-react'

type Point = { x: number; y: number }
type Stroke = { color: string; width: number; points: Point[] }
type AssistantStroke = { color?: string; width?: number; points: Point[] }
type PianoRequest = { notes: string; tempo?: number; complete?: () => void }
type DrawingRequest = { title?: string; strokes: AssistantStroke[]; complete?: () => void }

const whiteNotes = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5']
const blackNotes = [
  { note: 'C#4', after: 0 }, { note: 'D#4', after: 1 }, { note: 'F#4', after: 3 }, { note: 'G#4', after: 4 }, { note: 'A#4', after: 5 },
  { note: 'C#5', after: 7 }, { note: 'D#5', after: 8 }, { note: 'F#5', after: 10 }, { note: 'G#5', after: 11 }, { note: 'A#5', after: 12 },
]
const colors = ['#20232b', '#e4584b', '#e4a534', '#319b77', '#3786d4', '#9b65c4']

function noteFrequency(note: string) {
  const match = /^([A-G])(#?)([45])$/.exec(note)
  if (!match) return null
  const semitones: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  const midi = 12 * (Number(match[3]) + 1) + semitones[match[1]] + (match[2] ? 1 : 0)
  return 440 * 2 ** ((midi - 69) / 12)
}

export function PianoApp() {
  const [pressed, setPressed] = useState<string[]>([])
  const [playing, setPlaying] = useState(false)
  const [tempo, setTempo] = useState(100)
  const audio = useRef<AudioContext | null>(null)

  const ensureAudioContext = () => {
    const AudioCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtor) return null
    if (!audio.current) audio.current = new AudioCtor()
    if (audio.current.state === 'suspended') void audio.current.resume()
    return audio.current
  }

  const playNote = (note: string, duration = 0.34) => {
    const frequency = noteFrequency(note)
    if (!frequency) return
    const context = ensureAudioContext()
    if (!context) return

    const now = context.currentTime
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'triangle'
    oscillator.frequency.setValueAtTime(frequency, now)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.1, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(now)
    oscillator.stop(now + duration + 0.04)

    setPressed((current) => [...current.filter((item) => item !== note), note])
    window.setTimeout(() => setPressed((current) => current.filter((item) => item !== note)), duration * 1000)
  }

  const playSequence = async (rawNotes: string, beatsPerMinute = tempo) => {
    const notes = rawNotes.split(/[\s,;]+/).map((note) => note.trim()).filter(Boolean).slice(0, 128)
    const valid = notes.filter((note) => noteFrequency(note))
    if (!valid.length) return
    setPlaying(true)
    const beat = 60000 / Math.max(50, Math.min(180, beatsPerMinute))
    for (const note of valid) {
      playNote(note, Math.max(0.15, beat / 1000 * 0.7))
      await new Promise<void>((resolve) => window.setTimeout(resolve, beat))
    }
    setPlaying(false)
  }
  useEffect(() => {
    const handlePlay = (event: Event) => {
      const request = (event as CustomEvent<PianoRequest>).detail
      if (request?.notes) void playSequence(request.notes, request.tempo).finally(() => request.complete?.())
    }
    window.addEventListener('mac-piano-play', handlePlay)
    return () => window.removeEventListener('mac-piano-play', handlePlay)
  }, [tempo])
  const keyButton = (note: string, black = false, style?: React.CSSProperties) => <button key={note} className={`piano-key ${black ? 'black' : 'white'} ${pressed.includes(note) ? 'pressed' : ''}`} style={style} aria-label={`Play ${note}`} onPointerDown={(event) => { event.preventDefault(); playNote(note) }} />
  return <section className="piano-app">
    <header className="creative-toolbar"><div className="creative-title"><Music2 size={17} /><strong>Grand Piano</strong></div><label className="tempo-control">Tempo <input aria-label="Tempo in beats per minute" type="range" min="50" max="180" value={tempo} onChange={(event) => setTempo(Number(event.target.value))} /><output>{tempo} BPM</output></label><span className={`playback-state ${playing ? 'active' : ''}`}>{playing ? 'Playing' : 'Ready'}</span></header>
    <div className="piano-stage"><div className="piano-caption"><span>CONCERT GRAND</span><span>88-key range · C4–B5</span></div><div className="piano-keybed">{whiteNotes.map((note) => keyButton(note))}{blackNotes.map(({ note, after }) => keyButton(note, true, { left: `${(after + 1) / whiteNotes.length * 100}%` }))}</div><p>Tap or press a key to play</p></div>
    <div className="piano-bottom"><span>Mac Assistant can perform a melody here.</span><button className="creative-action" disabled={playing} onClick={() => void playSequence('C4 E4 G4 C5 G4 E4 D4 F4 A4 D5 A4 F4 C4 E4 G4 C5')}>Play a little tune</button></div>
  </section>
}

export function DrawingApp() {
  const [strokes, setStrokes] = useState<Stroke[]>(() => {
    try { return JSON.parse(localStorage.getItem('mac-nos-drawing-strokes') ?? '[]') as Stroke[] } catch { return [] }
  })
  const [title, setTitle] = useState(() => localStorage.getItem('mac-nos-drawing-title') ?? 'Untitled Drawing')
  const [color, setColor] = useState(colors[0])
  const [width, setWidth] = useState(1.6)
  const [drawing, setDrawing] = useState<Point[] | null>(null)
  const canvas = useRef<SVGSVGElement>(null)
  useEffect(() => {
    try {
      localStorage.setItem('mac-nos-drawing-strokes', JSON.stringify(strokes))
      localStorage.setItem('mac-nos-drawing-title', title)
    } catch {}
  }, [strokes, title])
  useEffect(() => {
    const handleDraw = (event: Event) => {
      const request = (event as CustomEvent<DrawingRequest>).detail
      if (!request?.strokes?.length) { request?.complete?.(); return }
      if (request.title) setTitle(request.title.slice(0, 60))
      const valid = request.strokes.slice(0, 40).flatMap((stroke) => {
        if (!Array.isArray(stroke.points)) return []
        const points = stroke.points.slice(0, 300).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)).map((point) => ({ x: Math.max(0, Math.min(100, point.x)), y: Math.max(0, Math.min(100, point.y)) }))
        return points.length > 1 ? [{ color: stroke.color && /^#[\da-f]{6}$/i.test(stroke.color) ? stroke.color : '#20232b', width: Math.max(0.4, Math.min(4, stroke.width ?? 1.6)), points }] : []
      })
      setStrokes((current) => [...current, ...valid])
      request.complete?.()
    }
    window.addEventListener('mac-drawing-create', handleDraw)
    return () => window.removeEventListener('mac-drawing-create', handleDraw)
  }, [])
  const coordinates = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = canvas.current!.getBoundingClientRect()
    return { x: (event.clientX - bounds.left) / bounds.width * 100, y: (event.clientY - bounds.top) / bounds.height * 100 }
  }
  const finishStroke = () => {
    if (drawing && drawing.length > 1) setStrokes((current) => [...current, { color, width, points: drawing }])
    setDrawing(null)
  }
  const exportDrawing = () => {
    if (!canvas.current) return
    const copy = canvas.current.cloneNode(true) as SVGSVGElement
    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    background.setAttribute('width', '100')
    background.setAttribute('height', '100')
    background.setAttribute('fill', 'white')
    copy.prepend(background)
    const blob = new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${title.trim() || 'Untitled Drawing'}.svg`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const lines = drawing ? [...strokes, { color, width, points: drawing }] : strokes
  return <section className="drawing-app">
    <header className="creative-toolbar"><div className="creative-title"><Paintbrush size={17} /><input aria-label="Drawing title" value={title} onChange={(event) => setTitle(event.target.value)} /></div><div className="drawing-tools"><div className="drawing-swatches" aria-label="Brush color">{colors.map((swatch) => <button key={swatch} className={color === swatch ? 'selected' : ''} style={{ background: swatch }} aria-label={`Brush color ${swatch}`} onClick={() => setColor(swatch)} />)}</div><label className="brush-size"><Circle size={13} /> <input aria-label="Brush size" type="range" min="0.6" max="4" step="0.2" value={width} onChange={(event) => setWidth(Number(event.target.value))} /></label><button className="tool-icon" title="Undo stroke" aria-label="Undo stroke" disabled={!strokes.length} onClick={() => setStrokes((current) => current.slice(0, -1))}><RotateCcw size={15} /></button><button className="tool-icon" title="Clear canvas" aria-label="Clear canvas" disabled={!strokes.length} onClick={() => setStrokes([])}><Eraser size={15} /></button><button className="tool-icon" title="Export SVG" aria-label="Export SVG" onClick={exportDrawing}><Download size={15} /></button></div></header>
    <div className="drawing-paper"><svg ref={canvas} viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Drawing canvas" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setDrawing([coordinates(event)]) }} onPointerMove={(event) => { if (drawing) setDrawing((current) => current ? [...current, coordinates(event)] : null) }} onPointerUp={finishStroke} onPointerCancel={finishStroke}>{lines.map((stroke, index) => <polyline key={index} points={stroke.points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}</svg>{strokes.length === 0 && <span className="drawing-empty">Your canvas</span>}</div>
    <footer className="drawing-footer"><span>{strokes.length} {strokes.length === 1 ? 'stroke' : 'strokes'}</span><span><Trash2 size={13} /> Lives in this session</span></footer>
  </section>
}
