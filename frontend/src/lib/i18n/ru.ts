// Russian chrome dictionary — empty by design: a partial dict is a
// first-class state. Missing keys fall back to English; the chrome-i18n
// coverage report (scripts/check-chrome-i18n-coverage.mjs) tracks the gap.
import type { ChromeDict } from "./en"

export const ru: ChromeDict = {
  "motionReview.diagnostic.capacity": "Учитываются только первые {max} из выбранных. Удалите лишние.",
  "motionReview.diagnostic.unknown": "Движение «{motion}» недоступно и не добавляет фрагмент. Удалите или замените его.",
  "motionReview.diagnostic.omitted": "Пропущено из-за подключённого несовершеннолетнего: {motions}. Замените эти варианты.",
  "motionReview.diagnostic.omittedAll": "Пропущено из-за подключённого несовершеннолетнего: {motions}. Ни одно из выбранных движений не добавляет фрагмент.",
  "motionReview.diagnostic.multipleTargets": "Каждый Target выполняет отдельную копию последовательности. Для согласованной хореографии используйте отдельные ноды движения.",
  "motionReview.diagnostic.roles": "Один и тот же референс подключён и как Target, и как Partner. Подключите разных участников, прежде чем запускать это взаимодействие.",
  "motionReview.diagnostic.retired": "{motion} больше не предлагается для новых вариантов, но по-прежнему работает в сохранённых рабочих процессах.",
  "motionReview.diagnostic.replacement": "Используйте {motion}.",
  "motionReview.diagnostic.pace": "{motion} задаёт собственный темп. Установите Pace в Auto или замените движение.",
  "motionReview.diagnostic.requirements": "{motion} требует: {requirements}.",
  "motionReview.diagnostic.partnerReference": "Референс Partner: {names}; убедитесь, что он соответствует нужному получателю.",
  "motionReview.diagnostic.partnerFallback": "Подключите референс Partner, чтобы указать получателя; иначе его выберет модель.",
  "motionReview.diagnostic.sceneRequirements": "Задайте это в сцене или промпте; фрагмент не предоставляет референсные медиа.",
  "motionReview.diagnostic.visibility": "{before} заканчивается вне кадра перед {after}. Измените порядок или добавьте появление.",
  "motionReview.diagnostic.pose": "{before} заканчивается {fromPose}; {after} начинается {toPose}. Добавьте переход или замените движение.",
  "motionReview.diagnostic.hands": "После {before} руки остаются занятыми; для {after} нужны свободные руки. Сначала добавьте отпускание.",
  "motionReview.diagnostic.compound": "Составных вариантов: {count}. В короткие клипы могут уместиться не все фазы; проверьте последовательность, прежде чем добавлять действия.",
  "motionReview.diagnostic.standing": "стоя",
  "motionReview.diagnostic.seated": "сидя",
  "motionReview.diagnostic.floor": "на полу",
  "motionReview.diagnostic.any": "в любой позе",
  "motionReview.fragment": "Фрагмент, добавляемый в последующий промпт. Другие подключённые ноды и настройки генерации также влияют на итоговый промпт.",
  "motionReview.attention": "Требует внимания:",
  "motionReview.sequenceWarning": "Проверьте последовательность:",
  "motionReview.requires": "Требуется:",
}
