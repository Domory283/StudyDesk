import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as outbox from '../../lib/outbox.js';
import { stampNow } from '../../lib/serverClock.js';
import { enterSubmit } from '../../lib/imeSubmit.js';
import { toLocalISO } from '../../lib/dates.js';
import {
  ACTIVITY_STATUSES,
  CUT_CAPACITIES,
  SEMESTER_CAPACITY,
  pointsNeededForPass,
  summarizeGradeActivities,
  validatePointActivity,
} from '../../lib/pointsGrades.js';
import PastCourseModal from './PastCourseModal.jsx';

function uid() {
  return crypto.randomUUID();
}

const css = `
.gv-wrap{padding:16px 24px 80px;max-width:980px;margin:0 auto;}
.gv-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px;}
.gv-title{font-family:var(--font-display);font-size:32px;font-weight:600;line-height:1.1;}
.gv-total{font-family:var(--font-display);font-size:38px;font-weight:600;line-height:1;}
.gv-label,.gv-meta{font-family:var(--font-mono);font-size:10px;letter-spacing:.07em;color:var(--muted);text-transform:uppercase;}
.gv-toolbar{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap;align-items:center;}
.gv-toolbar select{width:auto;min-width:150px;}
.gv-subject{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:10px;}
.gv-subject-head{display:flex;align-items:center;gap:10px;}
.gv-subject-pip{width:10px;height:10px;border-radius:50%;flex-shrink:0;}
.gv-subject-name{flex:1;font-weight:600;font-size:15px;}
.gv-subject-meta{font-family:var(--font-mono);font-size:10px;color:var(--muted);margin-top:4px;letter-spacing:.04em;}
.gv-subject-total{font-family:var(--font-display);font-size:21px;font-weight:600;white-space:nowrap;}
.gv-summary{margin-top:14px;padding:13px;border:1px solid var(--border);border-radius:8px;background:var(--bg);}
.gv-summary-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px;}
.gv-summary-head strong{font-family:var(--font-display);font-size:19px;}
.gv-summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}
.gv-cut{padding:9px;background:var(--surface);border:1px solid var(--border);border-radius:6px;}
.gv-cut.active{border-color:var(--text);}
.gv-cut-head{display:flex;justify-content:space-between;gap:6px;font-family:var(--font-mono);font-size:10px;margin-bottom:7px;}
.gv-progress{height:6px;border-radius:4px;background:var(--surface2);overflow:hidden;margin-bottom:7px;}
.gv-progress span{display:block;height:100%;background:var(--text);border-radius:4px;}
.gv-cut-meta{font-size:11px;line-height:1.55;color:var(--muted);}
.gv-detail{display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;padding-top:9px;border-top:1px solid var(--border);font-size:12px;}
.gv-detail strong{font-family:var(--font-mono);font-weight:500;color:var(--text);}
.gv-activities{margin-top:14px;}
.gv-activities-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;}
.gv-activities-head strong{font-family:var(--font-mono);font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted2);}
.gv-activity{display:grid;grid-template-columns:minmax(110px,1fr) auto auto auto auto;gap:10px;align-items:center;padding:9px 0;border-top:1px solid var(--border);font-size:12px;}
.gv-activity-title{font-weight:500;overflow-wrap:anywhere;}
.gv-activity-points,.gv-activity-date{font-family:var(--font-mono);font-size:10px;color:var(--muted);white-space:nowrap;}
.gv-status{font-size:10px;color:var(--muted);white-space:nowrap;}
.gv-actions{display:flex;gap:4px;}
.gv-actions button{background:none;border:0;color:var(--muted2);cursor:pointer;padding:3px 5px;}
.gv-actions button:hover{color:var(--text);}
.gv-actions .danger:hover{color:#c0392b;}
.gv-empty{padding:26px 16px;text-align:center;border:1px dashed var(--border2);border-radius:8px;color:var(--muted);font-size:13px;}
.gv-legacy{margin-top:10px;padding:9px;border:1px dashed var(--border2);border-radius:6px;color:var(--muted);font-size:11px;}
.gv-legacy summary{cursor:pointer;font-weight:600;color:var(--text);}
.gv-legacy-row{display:flex;justify-content:space-between;gap:8px;padding-top:6px;}
.gv-arch-banner{margin:22px 0 8px;padding:9px 12px;background:var(--surface2);border-inline-start:3px solid var(--border2);font-family:var(--font-mono);font-size:10px;color:var(--muted);}
.gv-sem-head{display:flex;align-items:center;gap:8px;margin:18px 0 8px;}
.gv-sem-label{font-family:var(--font-mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted2);}
.gv-sem-count{font-family:var(--font-mono);font-size:10px;color:var(--muted2);}
.gv-sem-btn{margin-inline-start:auto;background:none;border:1px solid var(--border2);color:var(--muted);font-family:var(--font-mono);font-size:9px;text-transform:uppercase;padding:5px 9px;border-radius:4px;cursor:pointer;}
.gv-archived{opacity:.62;}
.gv-archived .gv-subject{background:var(--surface2);}
.gv-error{color:#b42318;font-size:12px;margin-top:8px;}
.gv-modal-help{font-size:11px;color:var(--muted);line-height:1.45;margin-top:4px;}
@media(max-width:620px){.gv-summary-grid{grid-template-columns:1fr;}.gv-activity{grid-template-columns:minmax(85px,1fr) auto auto;}.gv-activity-date{display:none;}.gv-title{font-size:27px;}.gv-total{font-size:32px;}}
`;

export default function GradesView({ state, dispatch, showFlash, session }) {
  const { t, i18n } = useTranslation();
  const allSubjects = Object.values(state.courses || {}).filter((course) => !course.deletedAt);
  const activeSubjects = allSubjects.filter((course) => !course.archivedAt);
  const archivedSubjects = allSubjects.filter((course) => !!course.archivedAt);
  const activities = (state.gradeActivities || []).filter((activity) => !activity.deletedAt);
  const legacyGrades = (state.grades || []).filter((grade) => !grade.deletedAt);
  const [showArchived, setShowArchived] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showAdd, setShowAdd] = useState(null);
  const [showPastCourse, setShowPastCourse] = useState(false);
  const [currentCut, setCurrentCut] = useState(1);

  const formatPoints = (value) => Number(value || 0).toLocaleString(i18n.language, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const groups = useMemo(() => {
    const bySemester = new Map();
    for (const subject of activeSubjects) {
      const key = subject.semester || '__nosem__';
      if (!bySemester.has(key)) bySemester.set(key, []);
      bySemester.get(key).push(subject);
    }
    return [...bySemester.entries()];
  }, [activeSubjects]);
  const archivedGroups = useMemo(() => {
    const bySemester = new Map();
    for (const subject of archivedSubjects) {
      const key = subject.semester || '__nosem__';
      if (!bySemester.has(key)) bySemester.set(key, []);
      bySemester.get(key).push(subject);
    }
    return [...bySemester.entries()];
  }, [archivedSubjects]);

  function openAdd(subjectId) {
    if (!allSubjects.length) {
      showFlash(t('gv.addCourseFirst'));
      return;
    }
    setEditing(null);
    setShowAdd({ subjectId: subjectId || activeSubjects[0]?.id || allSubjects[0].id });
  }

  function saveActivity(payload) {
    const validation = validatePointActivity(payload, activities, editing?.id || null);
    if (validation) return validation;
    const id = editing?.id || uid();
    dispatch({ type: editing ? 'EDIT_GRADE_ACTIVITY' : 'ADD_GRADE_ACTIVITY', id, ...payload });
    if (session) outbox.enqueue('upsert_grade_activity', { id, ...payload });
    setEditing(null);
    setShowAdd(null);
    showFlash(t(editing ? 'gv.activityUpdated' : 'gv.activityAdded'));
    return null;
  }

  function deleteActivity(activity) {
    if (!window.confirm(t('gv.deleteActivityConfirm', { title: activity.title }))) return;
    dispatch({ type: 'DELETE_GRADE_ACTIVITY', id: activity.id });
    if (session) outbox.enqueue('delete_grade_activity', { id: activity.id });
    showFlash(t('gv.activityDeleted'));
  }

  function createPastCourse(data) {
    const id = uid();
    const stamp = stampNow();
    dispatch({ type: 'ADD_COURSE', id, ...data, archivedAt: stamp });
    if (session) {
      outbox.enqueue('upsert_subject', {
        id, name: data.name, color: data.color, credits: data.credits,
        semester: data.semester, schoolYear: data.schoolYear, archivedAt: stamp,
      });
    }
    setShowPastCourse(false);
    setShowArchived(true);
    showFlash(t('gv.pcCreated', { name: data.name }));
    setEditing(null);
    setShowAdd({ subjectId: id });
  }

  function archiveSemester(semester) {
    if (!semester) return;
    const stamp = stampNow();
    dispatch({ type: 'ARCHIVE_SEMESTER', semester, stamp });
    showFlash(t('gv.archived', { name: semester }));
    if (session) outbox.enqueue('archive_semester', { courses: state.courses, semester, stamp });
  }

  function restoreSemester(semester) {
    if (!semester) return;
    const stamp = stampNow();
    dispatch({ type: 'RESTORE_SEMESTER', semester, stamp });
    showFlash(t('gv.restored', { name: semester }));
    if (session) outbox.enqueue('restore_semester', { courses: state.courses, semester, stamp });
  }

  function renderSubject(subject) {
    const ownActivities = activities
      .filter((activity) => activity.subjectId === subject.id)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const oldGrades = legacyGrades
      .filter((grade) => grade.subjectId === subject.id)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const summary = summarizeGradeActivities(activities, subject.id);
    const selectedCut = summary.cuts[currentCut - 1];
    const needed = pointsNeededForPass(summary.obtained, state.pointsPassMark);
    const canReach = needed != null && needed <= summary.remaining;
    const isOpen = expandedId === subject.id;

    return (
      <article key={subject.id} className="gv-subject">
        <div className="gv-subject-head">
          <span className="gv-subject-pip" style={{ background: subject.color || '#7a7570' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="gv-subject-name">{subject.name}</div>
            <div className="gv-subject-meta">
              {subject.semester || t('gv.noSemester')} · {t('gv.activityCount', { count: ownActivities.length })}
            </div>
          </div>
          <div className="gv-subject-total">{formatPoints(summary.obtained)} / {SEMESTER_CAPACITY}</div>
        </div>

        <section className="gv-summary" aria-label={t('gv.pointsTitle')}>
          <div className="gv-summary-head">
            <div>
              <div className="gv-label">{t('gv.semesterPoints')}</div>
              <strong>{formatPoints(summary.obtained)} / {SEMESTER_CAPACITY}</strong>
              <div className="gv-meta">
                {summary.percent.toLocaleString(i18n.language, { maximumFractionDigits: 2 })}% {t('gv.semesterObtained')}
                {' · '}{t('gv.equivalent')} {summary.equivalent.toFixed(2)} / 5.00
              </div>
            </div>
            <button className="btn-outline" type="button" onClick={() => openAdd(subject.id)}>
              {t('gv.addActivity')}
            </button>
          </div>

          <div className="gv-summary-grid">
            {summary.cuts.map((cut) => (
              <div key={cut.cut} className={`gv-cut${currentCut === cut.cut ? ' active' : ''}`}>
                <div className="gv-cut-head">
                  <strong>{t('gv.cut', { cut: cut.cut })}</strong>
                  <span>{formatPoints(cut.obtained)} / {cut.capacity}</span>
                </div>
                <div className="gv-progress" role="progressbar" aria-label={t('gv.cut', { cut: cut.cut })} aria-valuenow={Math.min(cut.capacity, cut.obtained)} aria-valuemin="0" aria-valuemax={cut.capacity}>
                  <span style={{ width: `${cut.progress}%` }} />
                </div>
                <div className="gv-cut-meta">
                  {t('gv.evaluated')}: {formatPoints(cut.evaluated)} · {t('gv.reserved')}: {formatPoints(cut.reserved)}
                </div>
              </div>
            ))}
          </div>
          <div className="gv-detail">
            <span>{t('gv.selectedCut')}: <strong>{formatPoints(selectedCut.obtained)} / {selectedCut.capacity}</strong></span>
            <span>{t('gv.evaluated')}: <strong>{formatPoints(selectedCut.evaluated)}</strong></span>
            <span>{t('gv.reserved')}: <strong>{formatPoints(selectedCut.reserved)}</strong></span>
            <span>{t('gv.unassignedCut')}: <strong>{formatPoints(selectedCut.unassigned)}</strong></span>
            <span>{t('gv.remainingSemester')}: <strong>{formatPoints(summary.remaining)}</strong></span>
          </div>
          {needed != null && (
            <div className="gv-detail">
              <span>{t('gv.passPointsNeeded')}: <strong>{formatPoints(needed)}</strong></span>
              <strong>{t(canReach ? 'gv.passReachable' : 'gv.passUnreachable')}</strong>
            </div>
          )}
        </section>

        <div className="gv-activities">
          <div className="gv-activities-head">
            <strong>{t('gv.activities')}</strong>
            <button
              type="button"
              className="btn-outline"
              onClick={() => setExpandedId(isOpen ? null : subject.id)}
            >
              {t(isOpen ? 'gv.hideActivities' : 'gv.showActivities')}
            </button>
          </div>
          {isOpen && (
            ownActivities.length === 0 ? (
              <div className="gv-empty">
                {t('gv.noActivities')}
                {' '}
                <button type="button" className="btn-outline" onClick={() => openAdd(subject.id)}>
                  {t('gv.addFirstActivity')}
                </button>
              </div>
            ) : ownActivities.map((activity) => (
              <div key={activity.id} className="gv-activity">
                <span className="gv-activity-title">{activity.title}</span>
                <span className="gv-activity-points">
                  {activity.status === 'graded' ? formatPoints(activity.earnedPoints) : '—'} / {formatPoints(activity.maxPoints)}
                </span>
                <span className="gv-status">{t(`gv.status_${activity.status}`)}</span>
                <span className="gv-activity-date">{t('gv.cut', { cut: activity.cut })} · {activity.date || '—'}</span>
                <span className="gv-actions">
                  <button type="button" onClick={() => { setEditing(activity); setShowAdd({ subjectId: activity.subjectId }); }} title={t('common.edit')}>✎</button>
                  <button type="button" className="danger" onClick={() => deleteActivity(activity)} title={t('common.delete')}>×</button>
                </span>
              </div>
            ))
          )}
        </div>

        {oldGrades.length > 0 && (
          <details className="gv-legacy">
            <summary>{t('gv.legacyTitle', { count: oldGrades.length })}</summary>
            <p>{t('gv.legacyNote')}</p>
            {oldGrades.map((grade) => (
              <div className="gv-legacy-row" key={grade.id}>
                <span>{formatPoints(grade.grade)} · {grade.date || '—'}</span>
                <span>{t('gv.legacyNotCounted')}</span>
              </div>
            ))}
          </details>
        )}
      </article>
    );
  }

  return (
    <>
      <style>{css}</style>
      <div className="gv-wrap">
        <div className="gv-hero">
          <div>
            <div className="gv-label">{t('gv.pointsTitle')}</div>
            <div className="gv-title">{t('gv.semesterPoints')}</div>
          </div>
          <div>
            <div className="gv-label">{t('gv.currentCut')}</div>
            <select value={currentCut} onChange={(event) => setCurrentCut(Number(event.target.value))}>
              {Object.keys(CUT_CAPACITIES).map((cut) => (
                <option key={cut} value={cut}>{t('gv.cut', { cut })} · {CUT_CAPACITIES[cut]} {t('gv.points')}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="gv-toolbar">
          <button className="btn" type="button" onClick={() => openAdd()} disabled={!allSubjects.length}>
            {t('gv.addActivity')}
          </button>
          <button className="btn-outline" type="button" onClick={() => setShowPastCourse(true)}>
            {t('gv.addPastCourse')}
          </button>
          {archivedSubjects.length > 0 && (
            <button className="btn-outline" type="button" onClick={() => setShowArchived((value) => !value)}>
              {t(showArchived ? 'gv.hideArchived' : 'gv.showArchived', { count: archivedSubjects.length })}
            </button>
          )}
          <label className="input-group" style={{ margin: 0, minWidth: 180 }}>
            <span className="input-label">{t('gv.minimumPassingGrade')}</span>
            <input
              type="number"
              min="0"
              max="5"
              step="0.01"
              value={state.pointsPassMark ?? ''}
              placeholder={t('gv.optional')}
              onChange={(event) => {
                const value = event.target.value;
                if (value === '' || (Number(value) >= 0 && Number(value) <= 5)) {
                  dispatch({ type: 'SET_POINTS_PASS_MARK', value: value === '' ? null : Number(value) });
                }
              }}
            />
          </label>
        </div>

        {!allSubjects.length && (
          <div className="gv-empty">{t('gv.noCoursesBody')}</div>
        )}
        {groups.map(([semester, subjects]) => (
          <section key={semester}>
            <div className="gv-sem-head">
              <span className="gv-sem-label">{semester === '__nosem__' ? t('gv.noSemester') : semester}</span>
              <span className="gv-sem-count">{t('gv.courses', { count: subjects.length })}</span>
              {semester !== '__nosem__' && (
                <button className="gv-sem-btn" type="button" onClick={() => archiveSemester(semester)}>
                  {t('gv.archiveSemester')}
                </button>
              )}
            </div>
            {subjects.map(renderSubject)}
          </section>
        ))}

        {showArchived && archivedGroups.length > 0 && (
          <>
            <div className="gv-arch-banner">{t('gv.archivedBanner')}</div>
            {archivedGroups.map(([semester, subjects]) => (
              <section className="gv-archived" key={`archived-${semester}`}>
                <div className="gv-sem-head">
                  <span className="gv-sem-label">{semester === '__nosem__' ? t('gv.noSemester') : semester}</span>
                  <span className="gv-sem-count">{t('gv.courses', { count: subjects.length })}</span>
                  {semester !== '__nosem__' && (
                    <button className="gv-sem-btn" type="button" onClick={() => restoreSemester(semester)}>
                      {t('gv.restore')}
                    </button>
                  )}
                </div>
                {subjects.map(renderSubject)}
              </section>
            ))}
          </>
        )}

        {showAdd && (
          <GradeActivityModal
            subjects={activeSubjects}
            archivedSubjects={archivedSubjects}
            initial={editing || { subjectId: showAdd.subjectId }}
            isEdit={!!editing}
            onSave={saveActivity}
            onClose={() => { setShowAdd(null); setEditing(null); }}
          />
        )}
        {showPastCourse && (
          <PastCourseModal
            courses={state.courses}
            onCreate={createPastCourse}
            onClose={() => setShowPastCourse(false)}
          />
        )}
      </div>
    </>
  );
}

function GradeActivityModal({ subjects, archivedSubjects, initial, isEdit, onSave, onClose }) {
  const { t } = useTranslation();
  const everySubject = [...subjects, ...archivedSubjects];
  const [subjectId, setSubjectId] = useState(initial.subjectId || everySubject[0]?.id || '');
  const [cut, setCut] = useState(String(initial.cut || 1));
  const [title, setTitle] = useState(initial.title || '');
  const [status, setStatus] = useState(initial.status || 'pending');
  const [earnedPoints, setEarnedPoints] = useState(initial.earnedPoints == null ? '' : String(initial.earnedPoints));
  const [maxPoints, setMaxPoints] = useState(initial.maxPoints == null ? '' : String(initial.maxPoints));
  const [date, setDate] = useState(initial.date || toLocalISO(new Date()));
  const [allowOverCapacity, setAllowOverCapacity] = useState(Boolean(initial.allowOverCapacity));
  const [error, setError] = useState('');

  function submit() {
    const payload = {
      subjectId,
      cut: Number(cut),
      title: title.trim(),
      earnedPoints: status === 'graded' ? earnedPoints : null,
      maxPoints,
      status,
      date: date || null,
      allowOverCapacity,
    };
    const validation = onSave(payload);
    if (validation) setError(t(`gv.err_${validation}`));
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-title">{t(isEdit ? 'gv.editActivity' : 'gv.addActivity')}</div>
        <div className="input-group">
          <label className="input-label" htmlFor="grade-activity-subject">{t('gv.fCourse')}</label>
          <select id="grade-activity-subject" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
            {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            {archivedSubjects.length > 0 && (
              <optgroup label={t('gv.archivedGroup')}>
                {archivedSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
              </optgroup>
            )}
          </select>
        </div>
        <div className="input-group">
          <label className="input-label" htmlFor="grade-activity-cut">{t('gv.fCut')}</label>
          <select id="grade-activity-cut" value={cut} onChange={(event) => setCut(event.target.value)}>
            {Object.entries(CUT_CAPACITIES).map(([value, capacity]) => (
              <option key={value} value={value}>{t('gv.cut', { cut: value })} · {capacity} {t('gv.points')}</option>
            ))}
          </select>
        </div>
        <div className="input-group">
          <label className="input-label" htmlFor="grade-activity-title">{t('gv.fActivityName')}</label>
          <input id="grade-activity-title" type="text" maxLength="120" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
        </div>
        <div className="modal-grid">
          <div className="input-group">
            <label className="input-label" htmlFor="grade-activity-max">{t('gv.fMaxPoints')}</label>
            <input id="grade-activity-max" type="number" min="0.01" step="0.01" value={maxPoints} onChange={(event) => setMaxPoints(event.target.value)} />
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="grade-activity-status">{t('gv.fActivityStatus')}</label>
            <select id="grade-activity-status" value={status} onChange={(event) => setStatus(event.target.value)}>
              {ACTIVITY_STATUSES.map((value) => <option key={value} value={value}>{t(`gv.status_${value}`)}</option>)}
            </select>
          </div>
        </div>
        {status === 'graded' && (
          <div className="input-group">
            <label className="input-label" htmlFor="grade-activity-earned">{t('gv.fEarnedPoints')}</label>
            <input id="grade-activity-earned" type="number" min="0" max={maxPoints || undefined} step="0.01" value={earnedPoints} onChange={(event) => setEarnedPoints(event.target.value)} />
          </div>
        )}
        <div className="input-group">
          <label className="input-label" htmlFor="grade-activity-date">{t('gv.fDate')}</label>
          <input id="grade-activity-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} {...enterSubmit(submit)} />
        </div>
        <label className="gv-modal-help">
          <input type="checkbox" checked={allowOverCapacity} onChange={(event) => setAllowOverCapacity(event.target.checked)} />
          {' '}{t('gv.allowCutException')}
        </label>
        <div className="gv-modal-help">{t('gv.cutCapacityHelp', { capacity: CUT_CAPACITIES[cut] })}</div>
        {error && <div className="gv-error" role="alert">{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <button className="btn" type="button" onClick={submit}>{t(isEdit ? 'common.save' : 'gv.saveActivity')}</button>
          <button className="btn-outline" type="button" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  );
}
