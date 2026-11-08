"use client";

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IRunOptions,
  type ParagraphChild,
} from "docx";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { Root, RootContent, PhrasingContent, List, Table as MdTable } from "mdast";
import { formatClock, formatDate, formatDuration } from "./format";
import type { DigestLesson } from "./data";
import type { Course, KeyTerm, LessonSummary, Notebook, Question } from "./types";

/*
 * Word export: right-to-left, David 12pt body, styled headings, RTL tables and
 * lists, a title page, running header and page numbers. Markdown produced by
 * Claude (headings, lists, bold, tables, code, quotes) is converted to native
 * Word formatting, not pasted as text.
 */

const FONT = "David";
const FONT_SPEC = { ascii: FONT, hAnsi: FONT, cs: FONT, eastAsia: FONT };
const MONO = { ascii: "Consolas", hAnsi: "Consolas", cs: FONT, eastAsia: "Consolas" };
const BODY = 24; // half-points → 12pt
const ROYAL = "4C2A85";
const GOLD = "B8860B";
const MUTED = "6D6585";
const SOFT = "F1ECFA";

const hasHebrew = (s: string) => /[֐-׿]/.test(s);
const LRE = "\u202A"; // left-to-right embedding … pop directional formatting
const PDF = "\u202C";
/** Left-to-right marks keep formulas like |E|>1 intact inside a Hebrew line. */
const ltrSafe = (s: string) => (hasHebrew(s) ? s : `${LRE}${s}${PDF}`);

/** One text run with the right direction + complex-script sizing for Hebrew. */
function run(text: string, opts: Partial<IRunOptions> = {}): TextRun {
  const rtl = hasHebrew(text);
  const size = (opts.size as number | undefined) ?? BODY;
  return new TextRun({
    text,
    font: FONT_SPEC,
    size,
    sizeComplexScript: size,
    rightToLeft: rtl,
    ...(rtl ? { language: { value: "he-IL", bidirectional: "he-IL" } } : {}),
    ...opts,
    ...(opts.bold ? { boldComplexScript: true } : {}),
    ...(opts.italics ? { italicsComplexScript: true } : {}),
  });
}

function para(children: ParagraphChild[], opts: Record<string, unknown> = {}) {
  return new Paragraph({ bidirectional: true, alignment: AlignmentType.START, children, ...opts });
}

/* ---------------- Markdown → docx ---------------- */

interface Ctx {
  headingOffset: number; // markdown "#" maps to Heading(1 + offset)
  listInstance: { n: number };
}

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];

function inline(nodes: PhrasingContent[], style: Partial<IRunOptions> = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        if (n.value) out.push(run(n.value.replace(/\n/g, " "), style));
        break;
      case "strong":
        out.push(...inline(n.children, { ...style, bold: true, color: style.color ?? ROYAL }));
        break;
      case "emphasis":
        out.push(...inline(n.children, { ...style, italics: true }));
        break;
      case "delete":
        out.push(...inline(n.children, { ...style, strike: true }));
        break;
      case "inlineCode":
        out.push(
          new TextRun({
            text: ltrSafe(n.value),
            font: MONO,
            size: BODY - 2,
            sizeComplexScript: BODY - 2,
            rightToLeft: hasHebrew(n.value),
            shading: { type: ShadingType.CLEAR, color: "auto", fill: SOFT },
          }),
        );
        break;
      case "link":
        out.push(...inline(n.children, { ...style, color: ROYAL, underline: {} }));
        break;
      case "break":
        out.push(new TextRun({ break: 1 }));
        break;
      default:
        if ("children" in n) out.push(...inline(n.children as PhrasingContent[], style));
        else if ("value" in n && typeof n.value === "string") out.push(run(n.value, style));
    }
  }
  return out;
}

function block(node: RootContent, ctx: Ctx, level = 0): (Paragraph | Table)[] {
  switch (node.type) {
    case "heading": {
      const h = Math.min(HEADINGS.length - 1, node.depth - 1 + ctx.headingOffset);
      return [para(inline(node.children), { heading: HEADINGS[h] })];
    }
    case "paragraph":
      return [para(inline(node.children))];
    case "list":
      return list(node, ctx, level);
    case "table":
      return [table(node)];
    case "blockquote": // nested quotes (top-level ones get a styled rule in markdownToDocx)
      return node.children.flatMap((c) => block(c, ctx, level));
    case "code":
      return node.value.split("\n").map(
        (line, i, all) =>
          new Paragraph({
            bidirectional: false,
            alignment: AlignmentType.LEFT,
            shading: { type: ShadingType.CLEAR, color: "auto", fill: SOFT },
            spacing: { before: i === 0 ? 160 : 0, after: i === all.length - 1 ? 160 : 0, line: 260 },
            children: [new TextRun({ text: line || " ", font: MONO, size: 20, sizeComplexScript: 20 })],
          }),
      );
    case "thematicBreak":
      return [para([], { border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "D9D2E9", space: 4 } } })];
    case "html":
      return node.value.trim() ? [para([run(node.value.replace(/<[^>]+>/g, ""))])] : [];
    default:
      return [];
  }
}

function list(node: List, ctx: Ctx, level: number): (Paragraph | Table)[] {
  const instance = ++ctx.listInstance.n;
  const out: (Paragraph | Table)[] = [];
  for (const item of node.children) {
    let first = true;
    for (const child of item.children) {
      if (child.type === "paragraph" && first) {
        out.push(
          para(inline(child.children), {
            numbering: { reference: node.ordered ? "numbers" : "bullets", level: Math.min(level, 2), instance },
            spacing: { after: 60 },
          }),
        );
        first = false;
      } else if (child.type === "list") {
        out.push(...list(child, ctx, level + 1));
      } else {
        out.push(...block(child, ctx, level + 1));
      }
    }
  }
  return out;
}

function cell(children: ParagraphChild[], header: boolean, widthPct: number) {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: header ? { type: ShadingType.CLEAR, color: "auto", fill: SOFT } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [para(children, { spacing: { after: 0 } })],
  });
}

const tableBorders = {
  top: { style: BorderStyle.SINGLE, size: 4, color: "D9D2E9" },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: "D9D2E9" },
  left: { style: BorderStyle.SINGLE, size: 4, color: "D9D2E9" },
  right: { style: BorderStyle.SINGLE, size: 4, color: "D9D2E9" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "D9D2E9" },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "D9D2E9" },
};

function table(node: MdTable) {
  const cols = Math.max(1, ...node.children.map((r) => r.children.length));
  const w = Math.floor(100 / cols);
  return new Table({
    visuallyRightToLeft: true,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders,
    rows: node.children.map(
      (row, ri) =>
        new TableRow({
          tableHeader: ri === 0,
          children: Array.from({ length: cols }, (_, ci) => {
            const c = row.children[ci];
            const content = c ? inline(c.children, ri === 0 ? { bold: true } : {}) : [];
            return cell(content, ri === 0, w);
          }),
        }),
    ),
  });
}

export function markdownToDocx(md: string, headingOffset = 1, listInstance = { n: 0 }): (Paragraph | Table)[] {
  const tree: Root = fromMarkdown(md ?? "", { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const ctx: Ctx = { headingOffset, listInstance };
  return tree.children.flatMap((n) => {
    if (n.type === "blockquote") {
      // Render quotes as indented paragraphs with a gold side rule.
      return n.children.flatMap((c) =>
        c.type === "paragraph"
          ? [
              para(inline(c.children, { color: MUTED }), {
                indent: { start: 360 },
                border: { right: { style: BorderStyle.SINGLE, size: 18, color: GOLD, space: 8 } },
              }),
            ]
          : block(c, ctx),
      );
    }
    return block(n, ctx);
  });
}

/* ---------------- Building blocks ---------------- */

function heading(text: string, level: 0 | 1 | 2, extra?: string) {
  const children: ParagraphChild[] = [run(text)];
  if (extra) children.push(run(`  ${extra}`, { color: MUTED, size: 20, bold: false }));
  return para(children, { heading: HEADINGS[level] });
}

function box(children: ParagraphChild[], fill: string, border: string) {
  return para(children, {
    shading: { type: ShadingType.CLEAR, color: "auto", fill },
    border: { right: { style: BorderStyle.SINGLE, size: 24, color: border, space: 6 } },
    spacing: { before: 120, after: 200 },
  });
}

function bullets(items: string[], instance: { n: number }) {
  const i = ++instance.n;
  return items.map((t) => para([run(t)], { numbering: { reference: "bullets", level: 0, instance: i }, spacing: { after: 60 } }));
}

function glossaryTable(terms: KeyTerm[]) {
  return new Table({
    visuallyRightToLeft: true,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders,
    rows: [
      new TableRow({ tableHeader: true, children: [cell([run("מושג", { bold: true })], true, 28), cell([run("הגדרה", { bold: true })], true, 72)] }),
      ...terms.map(
        (k) => new TableRow({ cantSplit: true, children: [cell([run(k.term, { bold: true })], false, 28), cell([run(k.definition)], false, 72)] }),
      ),
    ],
  });
}

function lessonSummaryBlocks(title: string, meta: string, s: LessonSummary, instance: { n: number }) {
  const out: (Paragraph | Table)[] = [heading(title, 0), para([run(meta, { color: MUTED, size: 20 })], { spacing: { after: 160 } })];
  out.push(box([run("בקצרה: ", { bold: true, color: ROYAL }), run(s.overview)], SOFT, ROYAL));
  for (const sec of s.sections) {
    out.push(heading(sec.heading, 1, sec.startSec != null ? `(${formatClock(sec.startSec)})` : undefined));
    out.push(...markdownToDocx(sec.content, 2, instance));
  }
  if (s.takeaways.length) {
    out.push(heading("הכי חשוב לזכור", 1));
    out.push(...bullets(s.takeaways, instance));
  }
  if (s.keyTerms.length) {
    out.push(heading("מושגי מפתח", 1));
    out.push(glossaryTable(s.keyTerms));
  }
  if (s.openQuestions.length) {
    out.push(heading("משימות ונקודות פתוחות", 1));
    out.push(...bullets(s.openQuestions, instance));
  }
  return out;
}

function titlePage(kicker: string, title: string, lines: string[]) {
  return [
    para([], { spacing: { before: 2400 } }),
    para([run("הממלכה של גל", { color: GOLD, size: 28, bold: true })], { alignment: AlignmentType.CENTER }),
    para([run(kicker, { color: MUTED, size: 28 })], { alignment: AlignmentType.CENTER, spacing: { before: 400 } }),
    para([run(title, { size: 64, bold: true, color: ROYAL })], { alignment: AlignmentType.CENTER, spacing: { before: 200, after: 400 } }),
    ...lines.map((l) => para([run(l, { color: MUTED })], { alignment: AlignmentType.CENTER, spacing: { after: 80 } })),
    para([new PageBreak()]),
  ];
}

function makeDocument(headerText: string, children: (Paragraph | Table)[]) {
  const heading = (size: number, color: string, before: number) => ({
    run: { font: FONT_SPEC, size, sizeComplexScript: size, bold: true, boldComplexScript: true, color },
    paragraph: { spacing: { before, after: 140 }, keepNext: true, keepLines: true },
  });
  return new Document({
    creator: "הממלכה של גל",
    title: headerText,
    styles: {
      default: {
        document: {
          run: { font: FONT_SPEC, size: BODY, sizeComplexScript: BODY, language: { value: "he-IL", bidirectional: "he-IL" } },
          paragraph: { spacing: { after: 120, line: 312 } },
        },
        heading1: heading(40, ROYAL, 480),
        heading2: heading(31, ROYAL, 320),
        heading3: heading(26, "2F2347", 240),
        heading4: heading(BODY, "2F2347", 200),
      },
    },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.BULLET,
            text: ["•", "◦", "▪"][level],
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { start: 540 + level * 360, hanging: 300 } } },
          })),
        },
        {
          reference: "numbers",
          levels: [0, 1, 2].map((level) => ({
            level,
            format: [LevelFormat.DECIMAL, LevelFormat.HEBREW1, LevelFormat.LOWER_LETTER][level],
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { start: 540 + level * 360, hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: { top: 1300, bottom: 1300, left: 1250, right: 1250, header: 600, footer: 600 },
          },
          titlePage: true,
        },
        headers: {
          default: new Header({
            children: [
              para([run(headerText, { color: MUTED, size: 18 })], {
                border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "D9D2E9", space: 4 } },
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              para(
                [
                  new TextRun({
                    children: ["עמוד ", PageNumber.CURRENT, " מתוך ", PageNumber.TOTAL_PAGES],
                    font: FONT_SPEC,
                    size: 18,
                    sizeComplexScript: 18,
                    color: MUTED,
                    rightToLeft: true,
                  }),
                ],
                { alignment: AlignmentType.CENTER },
              ),
            ],
          }),
        },
        children,
      },
    ],
  });
}

/* ---------------- Public API ---------------- */

export async function notebookDocx(course: Course, nb: Notebook | null, lessons: DigestLesson[], includeLessons: boolean) {
  const instance = { n: 0 };
  const body: (Paragraph | Table)[] = [];
  const totalSec = lessons.reduce((s, l) => s + l.duration_sec, 0);
  body.push(
    ...titlePage("מחברת קורס", nb?.title || course.name, [
      `${lessons.length} שיעורים${totalSec ? ` · ${formatDuration(totalSec)} של הקלטה` : ""}`,
      `עודכן ${formatDate(Date.now())}`,
    ]),
  );

  // Table of contents (plain list, so Word doesn't ask to "update fields").
  body.push(heading("תוכן העניינים", 0));
  const tocItems = [
    ...(nb ? nb.chapters.map((c, i) => `פרק ${i + 1}: ${c.title}`) : []),
    ...(nb ? ["מילון מושגים", "הכנה למבחן"] : []),
    ...(includeLessons || !nb ? lessons.map((l, i) => `שיעור ${i + 1}: ${l.title}`) : []),
    ...(includeLessons && lessons.some((l) => l.quiz?.length) ? ["נספח: שאלות תרגול ומפתח תשובות"] : []),
  ];
  body.push(...tocItems.map((t) => para([run(t)], { spacing: { after: 60 }, indent: { start: 240 } })));
  body.push(para([new PageBreak()]));

  if (nb) {
    body.push(...markdownToDocx(nb.introduction, 1, instance));
    nb.chapters.forEach((c, i) => {
      body.push(para([new PageBreak()]));
      body.push(heading(`פרק ${i + 1}: ${c.title}`, 0));
      if (c.lessonNumbers.length) body.push(para([run(`מתוך שיעורים ${c.lessonNumbers.join(", ")}`, { color: MUTED, size: 20 })]));
      body.push(...markdownToDocx(c.content, 1, instance));
    });
    if (nb.glossary.length) {
      body.push(para([new PageBreak()]), heading("מילון מושגים", 0), glossaryTable(nb.glossary));
    }
    body.push(para([new PageBreak()]), heading("הכנה למבחן", 0));
    body.push(...markdownToDocx(nb.examPrep, 1, instance));
  }

  if (includeLessons || !nb) {
    if (nb) {
      body.push(para([new PageBreak()]));
      body.push(para([run("נספח: סיכומים לפי שיעור", { size: 44, bold: true, color: GOLD })], { alignment: AlignmentType.CENTER, spacing: { before: 2000 } }));
    }
    lessons.forEach((l, i) => {
      if (!l.summary) return;
      body.push(para([new PageBreak()]));
      body.push(
        ...lessonSummaryBlocks(
          `שיעור ${i + 1}: ${l.title}`,
          `${formatDate(l.created_at)}${l.duration_sec ? ` · ${formatDuration(l.duration_sec)}` : ""}`,
          l.summary,
          instance,
        ),
      );
    });
  }
  if (includeLessons) body.push(...practiceAppendix(lessons, instance));
  return Packer.toBlob(makeDocument(`${course.name} · מחברת קורס`, body));
}

const LETTERS = ["א", "ב", "ג", "ד", "ה", "ו"];

/** Printable practice: every lesson's quiz, then an answer key with explanations. */
function practiceAppendix(lessons: DigestLesson[], instance: { n: number }): (Paragraph | Table)[] {
  const withQuiz = lessons
    .map((l, i) => ({ l, n: i + 1, qs: (l.quiz ?? []).filter((q: Question) => q?.options?.length) }))
    .filter((x) => x.qs.length);
  if (!withQuiz.length) return [];
  const out: (Paragraph | Table)[] = [para([new PageBreak()])];
  out.push(para([run("נספח: שאלות תרגול", { size: 44, bold: true, color: GOLD })], { alignment: AlignmentType.CENTER, spacing: { before: 400, after: 200 } }));
  out.push(para([run("נסו לענות בלי להציץ. מפתח התשובות, עם הסברים, בסוף הנספח.", { color: MUTED })], { alignment: AlignmentType.CENTER, spacing: { after: 300 } }));
  for (const { l, n, qs } of withQuiz) {
    out.push(heading(`שיעור ${n}: ${l.title}`, 1));
    qs.forEach((q, i) => {
      out.push(para([run(`${i + 1}. `, { bold: true }), run(q.question, { bold: true })], { spacing: { before: 160, after: 60 }, keepNext: true }));
      q.options.forEach((o, oi) =>
        out.push(para([run(`${LETTERS[oi] ?? oi + 1}. `, { color: MUTED }), run(ltrSafe(o))], { indent: { start: 420 }, spacing: { after: 20 }, keepNext: oi < q.options.length - 1 })),
      );
    });
  }
  out.push(para([new PageBreak()]), heading("מפתח תשובות", 0));
  for (const { l, n, qs } of withQuiz) {
    out.push(heading(`שיעור ${n}: ${l.title}`, 2));
    out.push(
      new Table({
        visuallyRightToLeft: true,
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: tableBorders,
        rows: [
          new TableRow({ tableHeader: true, children: [cell([run("שאלה", { bold: true })], true, 10), cell([run("תשובה", { bold: true })], true, 12), cell([run("הסבר", { bold: true })], true, 78)] }),
          ...qs.map(
            (q, i) =>
              new TableRow({
                cantSplit: true,
                children: [cell([run(String(i + 1))], false, 10), cell([run(LETTERS[q.correctIndex] ?? String(q.correctIndex + 1), { bold: true, color: ROYAL })], false, 12), cell([run(q.explanation || "")], false, 78)],
              }),
          ),
        ],
      }),
    );
  }
  void instance;
  return out;
}

export async function lessonDocx(courseName: string, lesson: DigestLesson) {
  if (!lesson.summary) throw new Error("אין עדיין סיכום לשיעור");
  const instance = { n: 0 };
  const body = lessonSummaryBlocks(
    lesson.title,
    `${courseName} · ${formatDate(lesson.created_at)}${lesson.duration_sec ? ` · ${formatDuration(lesson.duration_sec)}` : ""}`,
    lesson.summary,
    instance,
  );
  const doc = makeDocument(`${courseName} · ${lesson.title}`, body);
  return Packer.toBlob(doc);
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]+/g, " ").trim();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
