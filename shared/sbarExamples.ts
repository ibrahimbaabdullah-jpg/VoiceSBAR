// Explicitly fictional input and a labelled static demonstration, from nursing-sbar-handoff/examples.py.
import type { SbarLanguage, SbarReport } from './sbar';

export const SAMPLE_NOTES = "حالة وهمية للتدريب. المريض 65 سنة، دخل أمس بسبب التهاب رئوي حسب التشخيص الموثق.\nعنده سكري من النوع الثاني. واعٍ ومتجاوب. الساعة 7 صباحًا: الضغط 128/76، النبض 92،\nالحرارة 37.8 مئوية، التنفس 20 في الدقيقة، تشبع الأكسجين 95% على هواء الغرفة.\nالألم 2 من 10. لديه كانيولا في اليد اليسرى. مذكور أنه تلقى المضاد الحيوي الموصوف،\nلكن اسم الدواء وجرعته ووقت إعطائه غير مكتوبة هنا. الخطة الموثقة: متابعة نتيجة مزرعة الدم\nالمعلقة وتسليمها للفريق في الوردية التالية. الحساسية غير معروفة في هذه الملاحظات.";

export const SAMPLE_NOTES_EN = "Fictional training case. The patient is 65 years old, admitted yesterday with documented pneumonia.\nHas type 2 diabetes. Alert and responsive. At 7 AM: BP 128/76, pulse 92,\ntemperature 37.8 C, respiratory rate 20/min, oxygen saturation 95% on room air.\nPain 2/10. Has an IV cannula in the left hand. Received the prescribed antibiotic,\nbut the medication name, dose and administration time are not recorded here.\nDocumented plan: follow up the pending blood culture result and hand it over to the next shift.\nAllergies are unknown in these notes.";

const SAMPLE_REPORT_AR: SbarReport = {
  situation: [
    {
      text: "مريض وهمي، 65 سنة، أُدخل أمس بتشخيص موثق لالتهاب رئوي.",
      evidence: "المريض 65 سنة، دخل أمس بسبب التهاب رئوي حسب التشخيص الموثق"
    }
  ],
  background: [
    {
      text: "سكري من النوع الثاني.",
      evidence: "عنده سكري من النوع الثاني"
    },
    {
      text: "الحساسية غير معروفة.",
      evidence: "الحساسية غير معروفة في هذه الملاحظات"
    }
  ],
  assessment: [
    {
      text: "واعٍ ومتجاوب.",
      evidence: "واعٍ ومتجاوب"
    },
    {
      text: "الساعة 7 صباحًا: الضغط 128/76، النبض 92، الحرارة 37.8 مئوية، التنفس 20/دقيقة، SpO₂ 95% على هواء الغرفة.",
      evidence: "الساعة 7 صباحًا: الضغط 128/76، النبض 92،\nالحرارة 37.8 مئوية، التنفس 20 في الدقيقة، تشبع الأكسجين 95% على هواء الغرفة"
    },
    {
      text: "الألم 2/10. كانيولا في اليد اليسرى.",
      evidence: "الألم 2 من 10. لديه كانيولا في اليد اليسرى"
    },
    {
      text: "تلقّى المضاد الموصوف؛ الاسم والجرعة ووقت الإعطاء غير موثقة هنا.",
      evidence: "مذكور أنه تلقى المضاد الحيوي الموصوف،\nلكن اسم الدواء وجرعته ووقت إعطائه غير مكتوبة هنا"
    }
  ],
  recommendation: [
    {
      text: "حسب الخطة الموثقة: متابعة نتيجة مزرعة الدم المعلقة وتسليمها للفريق في الوردية التالية.",
      evidence: "الخطة الموثقة: متابعة نتيجة مزرعة الدم\nالمعلقة وتسليمها للفريق في الوردية التالية"
    }
  ],
  checklist: [
    {
      category: "allergies",
      status: "unclear",
      evidence: "الحساسية غير معروفة في هذه الملاحظات"
    },
    {
      category: "vitals",
      status: "documented",
      evidence: "الضغط 128/76، النبض 92،\nالحرارة 37.8 مئوية، التنفس 20 في الدقيقة، تشبع الأكسجين 95%"
    },
    {
      category: "vitals_time",
      status: "documented",
      evidence: "الساعة 7 صباحًا"
    },
    {
      category: "history",
      status: "documented",
      evidence: "عنده سكري من النوع الثاني"
    },
    {
      category: "medications",
      status: "partial",
      evidence: "اسم الدواء وجرعته ووقت إعطائه غير مكتوبة هنا"
    },
    {
      category: "consciousness",
      status: "documented",
      evidence: "واعٍ ومتجاوب"
    },
    {
      category: "pain",
      status: "documented",
      evidence: "الألم 2 من 10"
    },
    {
      category: "oxygen",
      status: "documented",
      evidence: "على هواء الغرفة"
    },
    {
      category: "lines",
      status: "documented",
      evidence: "لديه كانيولا في اليد اليسرى"
    },
    {
      category: "plan",
      status: "documented",
      evidence: "متابعة نتيجة مزرعة الدم\nالمعلقة وتسليمها للفريق في الوردية التالية"
    }
  ]
};

const SAMPLE_REPORT_EN: SbarReport = {
  situation: [
    {
      text: "Fictional patient, age 65, admitted yesterday with documented pneumonia.",
      evidence: "The patient is 65 years old, admitted yesterday with documented pneumonia"
    }
  ],
  background: [
    {
      text: "Type 2 diabetes.",
      evidence: "Has type 2 diabetes"
    },
    {
      text: "Allergies unknown.",
      evidence: "Allergies are unknown in these notes"
    }
  ],
  assessment: [
    {
      text: "Alert and responsive.",
      evidence: "Alert and responsive"
    },
    {
      text: "At 7 AM: BP 128/76, pulse 92, temperature 37.8 C, respiratory rate 20/min, SpO2 95% on room air.",
      evidence: "At 7 AM: BP 128/76, pulse 92,\ntemperature 37.8 C, respiratory rate 20/min, oxygen saturation 95% on room air"
    },
    {
      text: "Pain 2/10. IV cannula in the left hand.",
      evidence: "Pain 2/10. Has an IV cannula in the left hand"
    },
    {
      text: "Received the prescribed antibiotic; name, dose and administration time are not recorded here.",
      evidence: "Received the prescribed antibiotic,\nbut the medication name, dose and administration time are not recorded here"
    }
  ],
  recommendation: [
    {
      text: "Documented plan: follow up the pending blood culture result and hand it over to the next shift.",
      evidence: "Documented plan: follow up the pending blood culture result and hand it over to the next shift"
    }
  ],
  checklist: [
    {
      category: "allergies",
      status: "unclear",
      evidence: "Allergies are unknown in these notes"
    },
    {
      category: "vitals",
      status: "documented",
      evidence: "BP 128/76, pulse 92,\ntemperature 37.8 C, respiratory rate 20/min, oxygen saturation 95%"
    },
    {
      category: "vitals_time",
      status: "documented",
      evidence: "At 7 AM"
    },
    {
      category: "history",
      status: "documented",
      evidence: "Has type 2 diabetes"
    },
    {
      category: "medications",
      status: "partial",
      evidence: "the medication name, dose and administration time are not recorded here"
    },
    {
      category: "consciousness",
      status: "documented",
      evidence: "Alert and responsive"
    },
    {
      category: "pain",
      status: "documented",
      evidence: "Pain 2/10"
    },
    {
      category: "oxygen",
      status: "documented",
      evidence: "on room air"
    },
    {
      category: "lines",
      status: "documented",
      evidence: "Has an IV cannula in the left hand"
    },
    {
      category: "plan",
      status: "documented",
      evidence: "follow up the pending blood culture result and hand it over to the next shift"
    }
  ]
};

export function sampleNotes(language: SbarLanguage = 'ar'): string {
  return language === 'en' ? SAMPLE_NOTES_EN : SAMPLE_NOTES;
}

/** A fresh copy each call, so callers (and tests) can modify it freely. */
export function sampleReport(language: SbarLanguage = 'ar'): SbarReport {
  return structuredClone(language === 'en' ? SAMPLE_REPORT_EN : SAMPLE_REPORT_AR);
}
