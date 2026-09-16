// Arabic chrome dictionary — empty by design: a partial dict is a
// first-class state. Missing keys fall back to English; the chrome-i18n
// coverage report (scripts/check-chrome-i18n-coverage.mjs) tracks the gap.
import type { ChromeDict } from "./en"

export const ar: ChromeDict = {
  "motionReview.diagnostic.capacity": "لا تُحتسب سوى أول {max} من الاختيارات. أزل الاختيارات الزائدة.",
  "motionReview.diagnostic.unknown": "الحركة «{motion}» غير متاحة ولا تضيف أي مقطع. أزلها أو استبدلها.",
  "motionReview.diagnostic.omitted": "تم الحذف بسبب قاصر متصل: {motions}. استبدل هذه الاختيارات.",
  "motionReview.diagnostic.omittedAll": "تم الحذف بسبب قاصر متصل: {motions}. لا تضيف أي حركة مختارة مقطعًا.",
  "motionReview.diagnostic.multipleTargets": "يؤدي كل Target نسخة منفصلة من التسلسل. استخدم عقد حركة منفصلة للرقص المنسّق.",
  "motionReview.diagnostic.roles": "المرجع نفسه متصل بصفته Target وPartner معًا. صِل مشاركين مختلفين قبل تشغيل هذا التفاعل.",
  "motionReview.diagnostic.retired": "{motion} لم تعد متاحة للاختيارات الجديدة لكنها ما زالت تعمل في مسارات العمل المحفوظة.",
  "motionReview.diagnostic.replacement": "استخدم {motion}.",
  "motionReview.diagnostic.pace": "{motion} تحدد توقيتها بنفسها. اضبط Pace على Auto أو استبدل الحركة.",
  "motionReview.diagnostic.requirements": "{motion} تتطلب: {requirements}.",
  "motionReview.diagnostic.partnerReference": "مرجع Partner: {names}؛ تأكد من مطابقته للمتلقي المطلوب.",
  "motionReview.diagnostic.partnerFallback": "صِل مرجع Partner لتحديد المتلقي؛ وإلا سيختاره النموذج.",
  "motionReview.diagnostic.sceneRequirements": "وفّر هذه العناصر في المشهد أو الموجّه؛ المقطع لا يوفر وسائط مرجعية.",
  "motionReview.diagnostic.visibility": "{before} تنتهي خارج الإطار قبل {after}. أعد الترتيب أو أضف دخولًا.",
  "motionReview.diagnostic.pose": "{before} تنتهي {fromPose}؛ {after} تبدأ {toPose}. أضف انتقالًا أو استبدل حركة.",
  "motionReview.diagnostic.hands": "{before} تترك اليدين مشغولتين؛ {after} تحتاج إلى يدين حرّتين. أضف تحريرًا أولًا.",
  "motionReview.diagnostic.compound": "الاختيارات المركّبة: {count}. قد لا تتسع المقاطع القصيرة لكل المراحل؛ اختبر التسلسل قبل إضافة مزيد من الإجراءات.",
  "motionReview.diagnostic.standing": "واقفًا",
  "motionReview.diagnostic.seated": "جالسًا",
  "motionReview.diagnostic.floor": "على الأرض",
  "motionReview.diagnostic.any": "بأي وضعية",
  "motionReview.fragment": "الجزء المُضاف إلى الموجّه اللاحق. العُقد المتصلة الأخرى وإعدادات التوليد تؤثر أيضًا في الموجّه النهائي.",
  "motionReview.attention": "يحتاج إلى انتباه:",
  "motionReview.sequenceWarning": "تحقق من التسلسل:",
  "motionReview.requires": "يتطلب:",
}
