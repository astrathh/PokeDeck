const PATHS = {
  reload: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  volume: 'M11 5 6 9H3v6h3l5 4V5z M15.5 8.5a5 5 0 0 1 0 7 M18.5 5.5a9 9 0 0 1 0 13',
  mute: 'M11 5 6 9H3v6h3l5 4V5z M22 9l-6 6 M16 9l6 6',
  focus: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
  detach: 'M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6',
  attach: 'M4 4h16v16H4z M9 15l6-6 M9 9h6v6',
  plus: 'M12 5v14 M5 12h14',
  settings: 'M4 6h9 M17 6h3 M4 12h3 M11 12h9 M4 18h11 M19 18h1 M15 4v4 M9 10v4 M17 16v4',
  grid: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  columns: 'M4 4h4v16H4z M10 4h4v16h-4z M16 4h4v16h-4z',
  single: 'M4 4h16v16H4z',
  leaf: 'M5 19c0-8 6-14 15-14 0 9-6 15-14 15 M5 19l7-7',
  update: 'M12 3v12 M7 10l5 5 5-5 M5 21h14',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  logout: 'M15 4h4v16h-4 M10 8l-4 4 4 4 M6 12h10',
  code: 'M8 8l-4 4 4 4 M16 8l4 4-4 4',
  home: 'M4 11l8-7 8 7 M6 9v11h12V9',
  pause: 'M8 5v14 M16 5v14',
  play: 'M7 5l12 7-12 7z',
  close: 'M6 6l12 12 M18 6L6 18',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6l1-7z'
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
