"use client";

import { useState } from "react";
import { createCourse, updateCourse, useCourses } from "@/lib/data";
import { COURSE_COLORS } from "@/lib/format";
import type { Course } from "@/lib/types";
import { Modal, Spinner, useToast } from "./ui";

export function CourseForm(props: {
  course?: Course;
  onDone: (course: Course) => void;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const { data: courses } = useCourses();
  const [name, setName] = useState(props.course?.name ?? "");
  const [vocab, setVocab] = useState(props.course?.vocabulary ?? "");
  const [color, setColor] = useState(props.course?.color ?? COURSE_COLORS[(courses?.length ?? 0) % COURSE_COLORS.length]);
  const [examDate, setExamDate] = useState(props.course?.exam_date ?? "");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (props.course) {
        await updateCourse(props.course.id, { name: name.trim(), vocabulary: vocab.trim(), color, exam_date: examDate || null });
        props.onDone({ ...props.course, name: name.trim(), vocabulary: vocab.trim(), color, exam_date: examDate || null });
      } else {
        const c = await createCourse({ name: name.trim(), vocabulary: vocab.trim(), color });
        if (examDate) await updateCourse(c.id, { exam_date: examDate });
        props.onDone({ ...c, exam_date: examDate || null });
      }
    } catch (err) {
      toast(`השמירה נכשלה: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="course-name">שם הקורס</label>
        <input id="course-name" className="input" autoFocus required maxLength={200} placeholder="לדוגמה: מבוא לכלכלה" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="course-vocab">מונחים ושמות שחוזרים בקורס <span className="text-muted font-normal">(לא חובה)</span></label>
        <input id="course-vocab" className="input" placeholder="גמישות, עקומת ביקוש, Elasticity, פרופ׳ כהן" value={vocab} onChange={(e) => setVocab(e.target.value)} />
        <p className="hint">עוזר לתמלול לזהות נכון מונחים מקצועיים, שמות ומילים באנגלית.</p>
      </div>
      {!props.compact && (
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <span className="label">צבע</span>
            <div className="flex flex-wrap gap-2">
              {COURSE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full transition ${color === c ? "ring-2 ring-offset-2 ring-offset-card ring-ink scale-110" : ""}`}
                  style={{ background: c }}
                  aria-label={`צבע ${c}`}
                  aria-pressed={color === c}
                />
              ))}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="course-exam">תאריך מבחן <span className="text-muted font-normal">(לא חובה)</span></label>
            <input id="course-exam" type="date" className="input" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
          </div>
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <button className="btn btn-primary" disabled={busy || !name.trim()}>
          {busy && <Spinner className="w-4 h-4" />}
          {props.course ? "שמירה" : "יצירת קורס"}
        </button>
        {props.onCancel && (
          <button type="button" className="btn btn-ghost" onClick={props.onCancel}>ביטול</button>
        )}
      </div>
    </form>
  );
}

export function CourseModal(props: { open: boolean; onClose: () => void; course?: Course; onDone?: (c: Course) => void }) {
  return (
    <Modal open={props.open} onClose={props.onClose} title={props.course ? "עריכת קורס" : "קורס חדש"}>
      <CourseForm
        course={props.course}
        onCancel={props.onClose}
        onDone={(c) => {
          props.onDone?.(c);
          props.onClose();
        }}
      />
    </Modal>
  );
}
