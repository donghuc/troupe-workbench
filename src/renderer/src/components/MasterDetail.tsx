import type { ReactNode } from 'react'

// Reusable list + detail layout shared by Notes, Skills, Files, … :
//   [ list panel ][ detail pane ]
// - listHeader: actions at the top of the list (e.g. a "New" button, a filter)
// - list:       the rows
// - header:     the detail pane's top bar (title + actions) — put buttons here
// - children:   the detail content
// - contentWhite: give the content pane the light "paper" surface
interface Props {
  listHeader?: ReactNode
  list: ReactNode
  header?: ReactNode
  children: ReactNode
  contentWhite?: boolean
  contentClassName?: string
  listWidth?: number
}

export default function MasterDetail({ listHeader, list, header, children, contentWhite, contentClassName, listWidth }: Props) {
  return (
    <div className="md-view">
      <div className="md-list" style={listWidth ? { width: listWidth, minWidth: listWidth } : undefined}>
        {listHeader && <div className="md-list-head">{listHeader}</div>}
        <div className="md-list-body">{list}</div>
      </div>
      <div className="md-main">
        {header && <div className="md-head">{header}</div>}
        <div className={`md-content${contentWhite ? ' md-content-white' : ''}${contentClassName ? ' ' + contentClassName : ''}`}>
          {children}
        </div>
      </div>
    </div>
  )
}
