import type { Project } from '../../../shared/types'

interface Props {
  projects: Project[]
  onOpen: (id: string) => void
  onNew: () => void
}

export default function ProjectsOverview({ projects, onOpen, onNew }: Props) {
  return (
    <div className="main-body">
      <section className="project-home">
        <h1 className="page-title">Projects</h1>
        <div className="projects-grid">
          <button className="project-card project-card-new" onClick={onNew}>
            <span className="card-title">+ New project</span>
            <span className="card-meta">Start a new workspace</span>
          </button>
          {projects.map((p) => (
            <button key={p.id} className="project-card" onClick={() => onOpen(p.id)}>
              <span className="card-title">{p.name}</span>
              <span className="card-meta truncate">{p.description || 'No description'}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
