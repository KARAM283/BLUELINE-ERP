import { useEffect, useState } from 'react'
import { FileText, FolderOpen, Pencil, Plus, RefreshCw, Star, Upload } from 'lucide-react'
import type { HrCandidate, HrCandidateUpload, HrDepartment } from '../shared/types'

type CandidateEditor = {
  candidate: HrCandidate | null
  upload: HrCandidateUpload | null
  fullName: string
  phone: string
  email: string
  departmentId: number
  notes: string
}

export function HrCvsBank({ departments, setNotice }: {
  departments: HrDepartment[]
  setNotice: (message: string) => void
}) {
  const [candidates, setCandidates] = useState<HrCandidate[]>([])
  const [editor, setEditor] = useState<CandidateEditor | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const cvDepartments = departments.filter((department) => !['office boy', 'manager'].includes(department.name.trim().toLowerCase()))
  const cvCandidates = candidates.filter((candidate) => !['office boy', 'manager'].includes(candidate.departmentName.trim().toLowerCase()))

  async function refresh() {
    setLoading(true)
    try {
      setCandidates(await window.blueLine.hr.listCandidates())
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to load candidate records.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  useEffect(() => {
    const uploadId = editor?.upload?.uploadId
    if (!uploadId) return
    return () => {
      void window.blueLine.hr.cancelCandidateUpload(uploadId).catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : 'Unable to clear the pending candidate file.')
      })
    }
  }, [editor?.upload?.uploadId, setNotice])

  async function startUpload(departmentId: number) {
    try {
      const upload = await window.blueLine.hr.selectCandidateFile()
      if (!upload) return
      setEditor({
        candidate: null,
        upload,
        fullName: upload.suggestedName,
        phone: '',
        email: '',
        departmentId,
        notes: ''
      })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to select the candidate file.')
    }
  }

  function editCandidate(candidate: HrCandidate) {
    setEditor({
      candidate,
      upload: null,
      fullName: candidate.fullName,
      phone: candidate.phone,
      email: candidate.email,
      departmentId: candidate.departmentId,
      notes: candidate.notes
    })
  }

  async function saveCandidate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor) return
    setSaving(true)
    try {
      const details = {
        fullName: editor.fullName,
        phone: editor.phone,
        email: editor.email,
        departmentId: editor.departmentId,
        notes: editor.notes
      }
      if (editor.candidate) {
        await window.blueLine.hr.updateCandidate({ ...details, id: editor.candidate.id })
        setNotice('Candidate updated.')
      } else if (editor.upload) {
        await window.blueLine.hr.createCandidate({ ...details, uploadId: editor.upload.uploadId })
        setNotice('CV added to the department pipeline.')
      }
      setEditor(null)
      await refresh()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to save the candidate.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleStar(candidate: HrCandidate) {
    try {
      await window.blueLine.hr.setCandidateStarred(candidate.id, !candidate.isStarred)
      setCandidates((current) => current.map((item) => item.id === candidate.id
        ? { ...item, isStarred: !candidate.isStarred }
        : item))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to update the candidate star.')
    }
  }

  async function openFile(candidate: HrCandidate) {
    try {
      await window.blueLine.hr.openCandidateFile(candidate.id)
      setNotice('Candidate file opened.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to open the candidate file.')
    }
  }

  return <section className="hr-section hr-cvs-bank">
    <div className="panel hr-panel">
      <div className="panel-heading">
        <div><h2>CVs Bank</h2><p>Candidate pipeline by department. Files stay in private local storage.</p></div>
        <div className="hr-actions">
          <span className="hr-cvs-count">{cvCandidates.length} {cvCandidates.length === 1 ? 'candidate' : 'candidates'}</span>
          <button type="button" className="secondary-btn small" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} />Refresh
          </button>
        </div>
      </div>
      {loading ? <p className="hr-empty">Loading candidates…</p> : cvDepartments.length
        ? <div className="hr-cvs-board">
          {cvDepartments.map((department) => {
            const departmentCandidates = cvCandidates.filter((candidate) => candidate.departmentId === department.id)
            return <section className="hr-cvs-column" key={department.id} aria-labelledby={`hr-cvs-department-${department.id}`}>
              <div className="hr-cvs-column-heading">
                <h3 id={`hr-cvs-department-${department.id}`}>{department.name}</h3>
                <span>{departmentCandidates.length}</span>
                <button type="button" className="secondary-btn small" onClick={() => void startUpload(department.id)}>
                  <Plus size={13} />Add CV
                </button>
              </div>
              <div className="hr-cvs-candidates">
                {departmentCandidates.map((candidate) => <article className="hr-cvs-card" key={candidate.id}>
                  <div className="hr-cvs-card-heading">
                    <span className="hr-cvs-file-icon"><FileText size={17} /></span>
                    <div className="hr-cvs-candidate-title"><h4>{candidate.fullName}</h4><span title={candidate.fileName}>{candidate.fileName}</span></div>
                    <button
                      type="button"
                      className={`hr-cvs-star${candidate.isStarred ? ' starred' : ''}`}
                      aria-label={candidate.isStarred ? `Remove ${candidate.fullName} from strong candidates` : `Mark ${candidate.fullName} as a strong candidate`}
                      aria-pressed={candidate.isStarred}
                      onClick={() => void toggleStar(candidate)}
                    ><Star size={17} fill={candidate.isStarred ? 'currentColor' : 'none'} /></button>
                  </div>
                  {(candidate.phone || candidate.email) && <p className="hr-cvs-contact">{[candidate.phone, candidate.email].filter(Boolean).join(' · ')}</p>}
                  {candidate.notes && <p className="hr-cvs-notes">{candidate.notes}</p>}
                  <div className="hr-cvs-card-actions">
                    <button type="button" className="secondary-btn small" onClick={() => void openFile(candidate)}><FolderOpen size={13} />Open file</button>
                    <button type="button" className="text-btn" onClick={() => editCandidate(candidate)}><Pencil size={13} />Edit</button>
                  </div>
                </article>)}
                {!departmentCandidates.length && <p className="hr-cvs-empty">No candidates yet.</p>}
              </div>
            </section>
          })}
        </div>
        : <p className="hr-empty">Add a department before creating a candidate pipeline.</p>}
    </div>
    {editor && <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) setEditor(null)
    }}>
      <form className="modal hr-modal hr-cvs-editor" role="dialog" aria-modal="true" aria-labelledby="hr-cvs-editor-title" onSubmit={(event) => void saveCandidate(event)}>
        <div className="modal-head">
          <div><p className="eyebrow">{editor.candidate ? 'CANDIDATE RECORD' : 'NEW CV'}</p><h2 id="hr-cvs-editor-title">{editor.candidate ? 'Edit candidate' : 'Add candidate'}</h2></div>
          <button type="button" className="icon-btn" disabled={saving} aria-label="Close dialog" onClick={() => setEditor(null)}>×</button>
        </div>
        {editor.upload && <div className="hr-cvs-upload-note" role="status">
          <Upload size={15} />
          <div><strong>{editor.upload.fileName}</strong><span>
            {editor.upload.nameSource === 'ocr' ? 'Name suggested by offline image OCR. Confirm or edit it below.' : 'Name suggested from the filename. Confirm or edit it below.'}
            {editor.upload.suggestionNote ? ` ${editor.upload.suggestionNote}` : ''}
          </span></div>
        </div>}
        <div className="hr-form">
          <label className="field"><span>Candidate name</span><input autoFocus required maxLength={120} value={editor.fullName} onChange={(event) => setEditor({ ...editor, fullName: event.target.value })} /></label>
          <label className="field"><span>Department</span><select required value={editor.departmentId} onChange={(event) => setEditor({ ...editor, departmentId: Number(event.target.value) })}>
            {cvDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
          </select></label>
          <div className="hr-form-pair">
            <label className="field"><span>Phone</span><input maxLength={50} value={editor.phone} onChange={(event) => setEditor({ ...editor, phone: event.target.value })} /></label>
            <label className="field"><span>Email</span><input type="email" maxLength={200} value={editor.email} onChange={(event) => setEditor({ ...editor, email: event.target.value })} /></label>
          </div>
          <label className="field"><span>Notes</span><textarea rows={3} maxLength={2000} value={editor.notes} onChange={(event) => setEditor({ ...editor, notes: event.target.value })} /></label>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-btn" disabled={saving} onClick={() => setEditor(null)}>Cancel</button>
          <button className="primary-btn" disabled={saving}>{saving ? 'Saving…' : editor.candidate ? 'Save changes' : 'Add to pipeline'}</button>
        </div>
      </form>
    </div>}
  </section>
}
