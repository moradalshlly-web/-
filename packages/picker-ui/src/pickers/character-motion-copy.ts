import { usePickerUiLocale } from "../i18n"

const en = {
  "capacity": "Remove a selection before adding another.",
  "sequence": "Motion sequence",
  "moveUp": "Move {label} up",
  "moveDown": "Move {label} down",
  "remove": "Remove {label}"
} as const
type CopyKey = keyof typeof en
const translations: Record<string, Record<CopyKey, string>> = {
  "he": {
    "capacity": "הסירו בחירה לפני הוספת בחירה נוספת.",
    "sequence": "רצף תנועה",
    "moveUp": "הזזת {label} למעלה",
    "moveDown": "הזזת {label} למטה",
    "remove": "הסרת {label}"
  },
  "ar": {
    "capacity": "أزل أحد الاختيارات قبل إضافة اختيار آخر.",
    "sequence": "تسلسل الحركة",
    "moveUp": "نقل {label} لأعلى",
    "moveDown": "نقل {label} لأسفل",
    "remove": "إزالة {label}"
  },
  "de": {
    "capacity": "Entferne eine Auswahl, bevor du eine weitere hinzufügst.",
    "sequence": "Bewegungsabfolge",
    "moveUp": "{label} nach oben verschieben",
    "moveDown": "{label} nach unten verschieben",
    "remove": "{label} entfernen"
  },
  "es": {
    "capacity": "Quita una selección antes de añadir otra.",
    "sequence": "Secuencia de movimiento",
    "moveUp": "Subir {label}",
    "moveDown": "Bajar {label}",
    "remove": "Quitar {label}"
  },
  "fr": {
    "capacity": "Retirez une sélection avant d'en ajouter une autre.",
    "sequence": "Séquence de mouvement",
    "moveUp": "Monter {label}",
    "moveDown": "Descendre {label}",
    "remove": "Retirer {label}"
  },
  "hi": {
    "capacity": "दूसरा जोड़ने से पहले एक चयन हटाएँ।",
    "sequence": "गति क्रम",
    "moveUp": "{label} को ऊपर ले जाएँ",
    "moveDown": "{label} को नीचे ले जाएँ",
    "remove": "{label} हटाएँ"
  },
  "ja": {
    "capacity": "追加する前に、選択を1つ削除してください。",
    "sequence": "モーションシーケンス",
    "moveUp": "{label} を上へ移動",
    "moveDown": "{label} を下へ移動",
    "remove": "{label} を削除"
  },
  "ko": {
    "capacity": "다른 항목을 추가하기 전에 선택을 하나 제거하세요.",
    "sequence": "모션 시퀀스",
    "moveUp": "{label} 위로 이동",
    "moveDown": "{label} 아래로 이동",
    "remove": "{label} 제거"
  },
  "pt-BR": {
    "capacity": "Remova uma seleção antes de adicionar outra.",
    "sequence": "Sequência de movimento",
    "moveUp": "Mover {label} para cima",
    "moveDown": "Mover {label} para baixo",
    "remove": "Remover {label}"
  },
  "ru": {
    "capacity": "Удалите один из выбранных элементов, прежде чем добавить другой.",
    "sequence": "Последовательность движений",
    "moveUp": "Переместить {label} вверх",
    "moveDown": "Переместить {label} вниз",
    "remove": "Удалить {label}"
  },
  "zh-CN": {
    "capacity": "请先移除一个选项，再添加新的选项。",
    "sequence": "动作序列",
    "moveUp": "上移 {label}",
    "moveDown": "下移 {label}",
    "remove": "移除 {label}"
  }
}

export function useCharacterMotionCopy() {
  const locale = usePickerUiLocale()
  const copy = translations[locale] ?? en
  return (key: CopyKey, label = "") => copy[key].replace(/\{label\}/g, () => label)
}
