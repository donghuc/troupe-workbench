import grid from '../assets/icons/grid.svg?raw'
import flash from '../assets/icons/flash.svg?raw'
import settings from '../assets/icons/settings.svg?raw'
import plus from '../assets/icons/plus.svg?raw'
import folderOpen from '../assets/icons/folder-open.svg?raw'
import pin from '../assets/icons/pin.svg?raw'
import more from '../assets/icons/more.svg?raw'
import send from '../assets/icons/send.svg?raw'
import stop from '../assets/icons/stop.svg?raw'
import chevronDown from '../assets/icons/chevron-down.svg?raw'
import image from '../assets/icons/image.svg?raw'
import globe from '../assets/icons/globe.svg?raw'
import file from '../assets/icons/file.svg?raw'
import close from '../assets/icons/close.svg?raw'
import search from '../assets/icons/search.svg?raw'
import copy from '../assets/icons/copy.svg?raw'
import link from '../assets/icons/link.svg?raw'
import check from '../assets/icons/check.svg?raw'
import moreVertical from '../assets/icons/more-vertical.svg?raw'
import popout from '../assets/icons/popout.svg?raw'
import refresh from '../assets/icons/refresh.svg?raw'
import memory from '../assets/icons/memory.svg?raw'
import clock from '../assets/icons/clock.svg?raw'
import edit from '../assets/icons/edit.svg?raw'
import info from '../assets/icons/info.svg?raw'
import film from '../assets/icons/film.svg?raw'
import external from '../assets/icons/external.svg?raw'
import chevronLeft from '../assets/icons/chevron-left.svg?raw'
import chevronRight from '../assets/icons/chevron-right.svg?raw'
import sidebar from '../assets/icons/sidebar.svg?raw'
import download from '../assets/icons/download.svg?raw'
import minus from '../assets/icons/minus.svg?raw'
import arrowUp from '../assets/icons/arrow-up.svg?raw'
import arrowDown from '../assets/icons/arrow-down.svg?raw'
import trash from '../assets/icons/trash.svg?raw'
import mic from '../assets/icons/mic.svg?raw'
import queue from '../assets/icons/queue.svg?raw'

const ICONS = {
  grid, flash, settings, plus, 'folder-open': folderOpen, pin, more, send, stop,
  'chevron-down': chevronDown, image, globe, file, close, search, copy, link, check, 'more-vertical': moreVertical, popout, refresh, memory, clock, edit, info, film, external,
  'chevron-left': chevronLeft, 'chevron-right': chevronRight, sidebar, download, minus, 'arrow-up': arrowUp, 'arrow-down': arrowDown, trash, mic, queue
} as const

export type IconName = keyof typeof ICONS

/** DS icon sizes (Dimension › icon-size/*): xs 12, sm 14, md 16, nav 18, lg 20, xl 28. */
export type IconSize = 'xs' | 'sm' | 'md' | 'nav' | 'lg' | 'xl'
interface Props { name: IconName; size?: IconSize; className?: string }

// Renders a headless line icon (recolored to currentColor) at a token size.
export default function Icon({ name, size = 'nav', className }: Props) {
  return (
    <span
      className={`icon${className ? ' ' + className : ''}`}
      style={{ width: `var(--icon-${size})`, height: `var(--icon-${size})` }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  )
}
