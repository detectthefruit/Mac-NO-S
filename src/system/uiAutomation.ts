import { normalizePath } from './store'
import type { AppId } from './types'

type AssistantUiCommand = {
  action: string
  app?: AppId
  path?: string
  content?: string
  notes?: string
  tempo?: number
  title?: string
  drawing?: string
}

function parseDrawing(value: string) {
  return value.split(';').slice(0, 40).flatMap((stroke) => {
    const [colorValue, widthValue, ...coordinateParts] = stroke.trim().split(':')
    const coordinates = coordinateParts.join(':').trim().split(/\s+/).slice(0, 150)
    const points = coordinates.flatMap((coordinate) => {
      const match = /^(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(coordinate)
      if (!match) return []
      return [{ x: Math.max(0, Math.min(100, Number(match[1]))), y: Math.max(0, Math.min(100, Number(match[2]))) }]
    })
    if (points.length < 2) return []
    const width = Number(widthValue)
    return [{
      color: /^#[\da-f]{6}$/i.test(colorValue) ? colorValue : '#20232b',
      width: Number.isFinite(width) ? Math.max(0.4, Math.min(4, width)) : 1.6,
      points,
    }]
  })
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))

export function requestAssistantConfirmation(title: string, message: string) {
  const id = `${Date.now()}-${Math.random()}`
  return new Promise<boolean>((resolve) => {
    const finish = (event: Event) => {
      const answer = (event as CustomEvent<{ id: string; approved: boolean }>).detail
      if (answer?.id !== id) return
      window.removeEventListener('mac-assistant-confirmed', finish)
      resolve(answer.approved)
    }
    window.addEventListener('mac-assistant-confirmed', finish)
    window.dispatchEvent(new CustomEvent('mac-assistant-confirm', { detail: { id, title, message } }))
  })
}

function showCursor(x: number, y: number, clicking = false, visible = true) {
  window.dispatchEvent(new CustomEvent('mac-assistant-cursor', { detail: { x, y, clicking, visible } }))
}

async function clickElement(element: HTMLElement) {
  element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
  const bounds = element.getBoundingClientRect()
  const x = bounds.left + bounds.width / 2
  const y = bounds.top + bounds.height / 2
  showCursor(x, y)
  await wait(430)
  showCursor(x, y, true)
  element.click()
  await wait(110)
  showCursor(x, y)
  await wait(100)
}

async function typeText(element: HTMLInputElement | HTMLTextAreaElement, text: string) {
  await clickElement(element)
  element.focus()
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')
  for (let index = 0; index < text.length; index++) {
    descriptor?.set?.call(element, text.slice(0, index + 1))
    element.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(18)
  }
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

async function findElement<T extends HTMLElement>(selector: string, description: string, timeout = 5000): Promise<T> {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const element = document.querySelector<T>(selector)
    if (element && element.getBoundingClientRect().width > 0) return element
    await wait(40)
  }
  throw new Error(`Mac Assistant couldn't find ${description}.`)
}

function findByData<T extends HTMLElement>(selector: string, key: string, value: string) {
  return Array.from(document.querySelectorAll<T>(selector)).find((element) => element.dataset[key] === value)
}

async function openVisibleApp(app: AppId) {
  const dockButton = await findElement<HTMLElement>(`[data-dock-app="${app}"]`, 'the app in the Dock')
  await clickElement(dockButton)
  await findElement<HTMLElement>(`[data-window-app="${app}"]`, `${app} window`)
  await wait(180)
}

async function navigateFinder(path: string) {
  await openVisibleApp('finder')
  const target = normalizePath(path || '/')
  const roots = ['/Desktop', '/Documents', '/Downloads', '/Pictures']
  const root = roots.find((candidate) => target === candidate || target.startsWith(`${candidate}/`))
  if (!root) {
    const rootButton = findByData<HTMLElement>('.sidebar-item', 'path', '/')
    if (!rootButton) throw new Error('Mac Assistant could not find Macintosh HD in Finder.')
    await clickElement(rootButton)
  } else {
    const rootButton = findByData<HTMLElement>('.sidebar-item', 'path', root)
    if (!rootButton) throw new Error(`Mac Assistant could not find ${root} in Finder.`)
    await clickElement(rootButton)
  }
  if (!root) return '/'
  const remaining = target.slice(root.length).split('/').filter(Boolean)
  let current = root
  for (const name of remaining) {
    current = normalizePath(`${current}/${name}`)
    const folder = findByData<HTMLElement>('[data-entry-path]', 'entryPath', current)
    if (!folder) throw new Error(`Finder could not find folder ${current}.`)
    await clickElement(folder)
    folder.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }))
    await wait(180)
  }
  return target
}

async function createEntry(command: AssistantUiCommand) {
  const target = normalizePath(command.path ?? '')
  if (target === '/') throw new Error('Choose a name for the new item.')
  const separator = target.lastIndexOf('/')
  const parent = normalizePath(target.slice(0, separator) || '/')
  const name = target.slice(separator + 1)
  if (!name || name === '.' || name === '..') throw new Error('Choose a valid name for the new item.')
  await navigateFinder(parent)
  if (findByData<HTMLElement>('[data-entry-path]', 'entryPath', target)) throw new Error(`${target} already exists in Finder.`)
  const toolbar = await findElement<HTMLElement>(`[title="New ${command.action === 'create_folder' ? 'folder' : 'file'}"]`, 'Finder’s New Item button')
  await clickElement(toolbar)
  const nameInput = await findElement<HTMLInputElement>('[data-assistant-entry-name]', 'the new item name field')
  await typeText(nameInput, name)
  const submit = await findElement<HTMLElement>('[data-assistant-entry-submit]', 'Finder’s create button')
  await clickElement(submit)
  await findElement<HTMLElement>(`[data-entry-path]`, 'the created Finder item')
  const created = findByData<HTMLElement>('[data-entry-path]', 'entryPath', target)
  if (!created) throw new Error(`Finder could not create ${target}. It may already exist.`)
  if (command.action === 'create_file') {
    await findElement<HTMLElement>('[data-window-app="textedit"]', 'TextEdit')
    const editor = await findElement<HTMLTextAreaElement>('[aria-label="Document text"]', 'the TextEdit document')
    if (command.content) {
      await typeText(editor, command.content)
      await clickElement(await findElement<HTMLElement>('[data-assistant-save]', 'TextEdit’s Save button'))
    }
  }
  return `Created ${target} in Finder${command.content ? ' and saved its contents in TextEdit' : ''}.`
}

export async function performVisibleAssistantCommand(command: AssistantUiCommand): Promise<string> {
  try {
    if (command.action === 'piano_play' && command.notes) {
      const notes = command.notes.split(/[\s,;]+/).map((note) => note.trim()).filter((note) => /^[A-G]#?[45]$/.test(note)).slice(0, 48)
      if (!notes.length) throw new Error('Choose piano notes in the C4–B5 range.')
      await openVisibleApp('piano')
      await new Promise<void>((resolve) => window.dispatchEvent(new CustomEvent('mac-piano-play', { detail: { notes: notes.join(','), tempo: Math.max(50, Math.min(180, command.tempo ?? 100)), complete: resolve } })))
      return `Played ${notes.length} notes on the Piano.`
    }
    if (command.action === 'drawing_create' && command.drawing) {
      const strokes = parseDrawing(command.drawing)
      if (!strokes.length) throw new Error('I could not parse the drawing paths. Use #RRGGBB:width:x,y x,y for each semicolon-separated stroke.')
      await openVisibleApp('drawing')
      await new Promise<void>((resolve) => window.dispatchEvent(new CustomEvent('mac-drawing-create', { detail: { title: command.title, strokes, complete: resolve } })))
      return `Drew ${strokes.length} strokes in Drawing.`
    }
    if (command.action === 'open_app' && command.app) {
      await openVisibleApp(command.app)
      return `Opened ${command.app}.`
    }
    if (command.action === 'create_file' || command.action === 'create_folder') return await createEntry(command)
    if (command.action === 'move_to_trash' && command.path) {
      const target = normalizePath(command.path)
      const parent = normalizePath(target.slice(0, target.lastIndexOf('/')) || '/')
      await navigateFinder(parent)
      const item = findByData<HTMLElement>('[data-entry-path]', 'entryPath', target)
      if (!item) throw new Error(`Finder could not find ${target}.`)
      await clickElement(item)
      await clickElement(await findElement<HTMLElement>('[title="Move selected to the Trash"]', 'Finder’s Trash button'))
      await clickElement(await findElement<HTMLElement>('[data-confirm-trash]', 'Finder’s Trash confirmation'))
      const stillExists = findByData<HTMLElement>('[data-entry-path]', 'entryPath', target)
      return stillExists ? `The user canceled moving ${target} to the Trash.` : `Moved ${target} to the Trash.`
    }
    if (command.action === 'read_file' && command.path) {
      const target = normalizePath(command.path)
      const parent = normalizePath(target.slice(0, target.lastIndexOf('/')) || '/')
      await navigateFinder(parent)
      const file = findByData<HTMLElement>('[data-entry-path]', 'entryPath', target)
      if (!file) throw new Error(`Finder could not find ${target}.`)
      await clickElement(file)
      file.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }))
      const editor = await findElement<HTMLTextAreaElement>('[aria-label="Document text"]', 'the TextEdit document')
      return editor.value || '(The file is empty.)'
    }
    if (command.action === 'list_files') {
      const folder = await navigateFinder(command.path ?? '/Documents')
      const pathPanel = Array.from(document.querySelectorAll<HTMLElement>('[data-current-folder]')).find((panel) => panel.dataset.currentFolder === folder)
      if (!pathPanel) throw new Error('Mac Assistant could not read Finder’s current view.')
      return Array.from(pathPanel.querySelectorAll<HTMLElement>('[data-entry-path]')).map((entry) => entry.innerText.trim()).join('\n') || 'This folder is empty.'
    }
    return 'That visual desktop action is not available.'
  } finally {
    showCursor(0, 0, false, false)
  }
}
