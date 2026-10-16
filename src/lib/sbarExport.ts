// Plain-text and printable exports of an SBAR report, ported from sbar.py (report_text, print_document).
import { CHECKS, DISCLAIMER, missingItems, SECTION_KEYS, SECTIONS, STATUSES, type SbarLanguage, type SbarReport } from '../../shared/sbar';
import { tr } from '../../shared/sbarI18n';

export function reportText(report: SbarReport, demo = false, language: SbarLanguage = 'ar'): string {
  const t = (text: string) => tr(text, language);
  const lines = [`${t('مُلخِّص التسليم التمريضي')} | SBAR`, t(DISCLAIMER)];
  if (demo) lines.push(t('مثال جاهز ثابت — لم يُنشأ بواسطة Gemini'));
  for (const key of SECTION_KEYS) {
    const [letter, title] = SECTIONS[key];
    lines.push('', `${letter} — ${t(title)}`);
    lines.push(...report[key].map((item) => `• ${item.text}`));
    if (!report[key].length) lines.push(t('غير مذكور في الملاحظات.'));
  }
  lines.push('', t('معلومات ناقصة أو تحتاج توضيحًا'));
  const missing = missingItems(report);
  lines.push(...missing.map((row) => `• ${t(CHECKS[row.category])}: ${t(STATUSES[row.status])}`));
  if (!missing.length) lines.push(t('لم يرصد الفحص الآلي نقصًا في قائمته المحدودة؛ راجع التقرير يدويًا.'));
  return lines.join('\n');
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

export function printDocument(report: SbarReport, demo = false, language: SbarLanguage = 'ar'): string {
  const direction = language === 'ar' ? 'rtl' : 'ltr';
  // Only escaped text enters the printable HTML; model HTML is never executed.
  const safe = escapeHtml(reportText(report, demo, language));
  return `<!doctype html><html lang="${language}" dir="${direction}"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${tr('تقرير SBAR', language)}</title>
<style>body{font-family:Tahoma,Arial,sans-serif;max-width:850px;margin:36px auto;padding:24px;color:#183d43}
pre{white-space:pre-wrap;font:16px/1.9 Tahoma,Arial,sans-serif}button{padding:12px 24px;border:0;border-radius:10px;background:#167568;color:white;cursor:pointer}
@media print{button{display:none}body{margin:0;padding:0}}@page{size:A4;margin:18mm}</style>
<button onclick="window.print()">${tr('طباعة / حفظ PDF', language)}</button><pre>${safe}</pre></html>`;
}

/** Saves text as a file. A byte-order mark makes Arabic display correctly in Windows Notepad. */
export function downloadFile(name: string, content: string, type: string): void {
  const blob = new Blob(['﻿', content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
