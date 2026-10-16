// Ported from nursing-sbar-handoff/tests/test_sbar.py (report_text, print_document).
import { describe, expect, it } from 'vitest';
import { validateReport } from '../../shared/sbar';
import { SAMPLE_NOTES_EN, sampleReport } from '../../shared/sbarExamples';
import { printDocument, reportText } from '../../src/lib/sbarExport';

describe('SBAR exports', () => {
  it('keeps an empty recommendation visibly missing', () => {
    const data = sampleReport();
    data.recommendation = [];
    expect(reportText(data)).toContain('R — التوصية\nغير مذكور');
  });

  it('escapes untrusted HTML and labels the demo in the printable copy', () => {
    const data = sampleReport();
    data.assessment[0]!.text = '<script>alert("x")</script>';
    const output = printDocument(data, true);
    expect(output).not.toContain('<script>');
    expect(output).toContain('&lt;script&gt;');
    expect(output).toContain('لم يُنشأ بواسطة Gemini');
    expect(output).toContain('lang="ar" dir="rtl"');
  });

  it('exports English without Arabic UI text', () => {
    const report = validateReport(sampleReport('en'), SAMPLE_NOTES_EN);
    const text = reportText(report, true, 'en');
    expect(text).toContain('S — Situation');
    expect(text).toContain('Allergies and reactions: Unclear');
    expect(text).toContain('Fixed example');
    expect(text).not.toMatch(/[؀-ۿ]/);
    const document = printDocument(report, true, 'en');
    expect(document).toContain('lang="en" dir="ltr"');
    expect(document).toContain('Print / Save PDF');
    report.recommendation = [];
    expect(reportText(report, false, 'en')).toContain('R — Recommendation\nNot mentioned in the notes.');
  });
});
