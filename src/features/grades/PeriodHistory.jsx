import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { summarizeGradeActivities } from '../../lib/pointsGrades.js';

const css = `
.ph-empty{font-size:13px;color:var(--muted);line-height:1.55;}
.ph-year{margin-bottom:6px;}
.ph-year + .ph-year{margin-top:14px;}
.ph-year-label{font-family:var(--font-mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted2);margin-bottom:8px;}
.ph-period{border:1px solid var(--border);border-radius:8px;background:var(--bg);margin-bottom:8px;overflow:hidden;}
.ph-period-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 13px;cursor:pointer;}
.ph-period-name{font-family:var(--font-display);font-size:15px;font-weight:600;display:flex;align-items:center;gap:8px;}
.ph-period-meta{font-family:var(--font-mono);font-size:11px;color:var(--muted);text-align:end;white-space:nowrap;}
.ph-points{font-family:var(--font-display);font-weight:600;color:var(--text);}
.ph-caret{color:var(--muted2);font-size:11px;}
.ph-courses{border-top:1px solid var(--border);padding:4px 13px 10px;}
.ph-course{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;font-size:13px;}
.ph-course + .ph-course{border-top:1px dashed var(--border);}
.ph-course-name{display:flex;align-items:center;gap:8px;min-width:0;}
.ph-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;}
.ph-course-points{font-family:var(--font-mono);font-size:12px;color:var(--text);white-space:nowrap;}
.ph-course-points.none{color:var(--muted2);}
`;

const NO_YEAR = '__noyear__';
const NO_PERIOD = '__noperiod__';

export default function PeriodHistory({ courses, gradeActivities = [] }) {
  const { t } = useTranslation();
  const grouped = useMemo(() => {
    const archived = Object.values(courses || {}).filter((course) => !course.deletedAt && course.archivedAt);
    const years = new Map();
    for (const course of archived) {
      const year = course.schoolYear || NO_YEAR;
      const period = course.semester || NO_PERIOD;
      if (!years.has(year)) years.set(year, new Map());
      const periods = years.get(year);
      if (!periods.has(period)) periods.set(period, []);
      periods.get(period).push(course);
    }
    return [...years.entries()]
      .sort(([a], [b]) => a === NO_YEAR ? 1 : b === NO_YEAR ? -1 : b.localeCompare(a))
      .map(([year, periods]) => [
        year,
        [...periods.entries()].sort(([a], [b]) =>
          a === NO_PERIOD ? 1 : b === NO_PERIOD ? -1 : a.localeCompare(b)),
      ]);
  }, [courses]);

  const [open, setOpen] = useState(() => new Set());
  const toggle = (key) => setOpen((previous) => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  if (!grouped.length) return <div className="ph-empty">{t('history.empty')}</div>;

  return (
    <>
      <style>{css}</style>
      {grouped.map(([year, periods]) => (
        <div className="ph-year" key={year}>
          <div className="ph-year-label">{year === NO_YEAR ? t('history.noSchoolYear') : year}</div>
          {periods.map(([period, subjects]) => {
            const key = `${year}::${period}`;
            const isOpen = open.has(key);
            const subjectSummaries = subjects.map((subject) => ({
              subject,
              summary: summarizeGradeActivities(gradeActivities, subject.id),
            }));
            const totalPoints = subjectSummaries.reduce((sum, item) => sum + item.summary.obtained, 0);
            return (
              <div className="ph-period" key={key}>
                <div
                  className="ph-period-head"
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(key)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggle(key);
                    }
                  }}
                >
                  <div className="ph-period-name">
                    <span className="ph-caret">{isOpen ? '▾' : '▸'}</span>
                    {period === NO_PERIOD ? t('history.noPeriod') : period}
                  </div>
                  <div className="ph-period-meta">
                    {t('history.course', { count: subjects.length })}
                    {' · '}{t('history.pointsAcrossCourses')}: <span className="ph-points">{totalPoints}</span>
                  </div>
                </div>
                {isOpen && (
                  <div className="ph-courses">
                    {subjectSummaries.map(({ subject, summary }) => (
                      <div className="ph-course" key={subject.id}>
                        <div className="ph-course-name">
                          <span className="ph-dot" style={{ background: subject.color || 'var(--muted2)' }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subject.name}</span>
                        </div>
                        <div className={`ph-course-points${summary.allocated ? '' : ' none'}`}>
                          {summary.obtained} / 500
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
