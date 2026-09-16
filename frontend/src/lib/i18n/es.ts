// Spanish chrome dictionary — empty by design: a partial dict is a
// first-class state. Missing keys fall back to English; the chrome-i18n
// coverage report (scripts/check-chrome-i18n-coverage.mjs) tracks the gap.
import type { ChromeDict } from "./en"

export const es: ChromeDict = {
  "motionReview.diagnostic.capacity": "Solo cuentan las primeras {max} selecciones. Elimina las selecciones sobrantes.",
  "motionReview.diagnostic.unknown": "El movimiento «{motion}» no está disponible y no aporta ningún fragmento. Elimínalo o reemplázalo.",
  "motionReview.diagnostic.omitted": "Omitido por un menor conectado: {motions}. Reemplaza estas selecciones.",
  "motionReview.diagnostic.omittedAll": "Omitido por un menor conectado: {motions}. Ningún movimiento seleccionado aporta un fragmento.",
  "motionReview.diagnostic.multipleTargets": "Cada Target ejecuta una copia independiente de la secuencia. Usa nodos de movimiento separados para una coreografía coordinada.",
  "motionReview.diagnostic.roles": "La misma referencia está conectada como Target y como Partner. Conecta participantes distintos antes de ejecutar esta interacción.",
  "motionReview.diagnostic.retired": "{motion} ya no se ofrece en las selecciones nuevas, pero sigue resolviéndose en los flujos de trabajo guardados.",
  "motionReview.diagnostic.replacement": "Usa {motion}.",
  "motionReview.diagnostic.pace": "{motion} define su propio ritmo. Ajusta Pace en Auto o reemplaza el movimiento.",
  "motionReview.diagnostic.requirements": "{motion} requiere: {requirements}.",
  "motionReview.diagnostic.partnerReference": "Referencia Partner: {names}; confirma que coincide con el destinatario requerido.",
  "motionReview.diagnostic.partnerFallback": "Conecta una referencia Partner para identificar al destinatario; de lo contrario, lo elegirá el modelo.",
  "motionReview.diagnostic.sceneRequirements": "Defínelos en la escena o en el prompt; el fragmento no aporta medios de referencia.",
  "motionReview.diagnostic.visibility": "{before} termina fuera de plano antes de {after}. Reordena o añade una entrada.",
  "motionReview.diagnostic.pose": "{before} termina {fromPose}; {after} empieza {toPose}. Añade una transición o reemplaza un movimiento.",
  "motionReview.diagnostic.hands": "{before} deja las manos ocupadas; {after} necesita las manos libres. Añade primero una acción de soltar.",
  "motionReview.diagnostic.compound": "Selecciones compuestas: {count}. Los clips cortos pueden no abarcar todas las fases; prueba la secuencia antes de añadir más acciones.",
  "motionReview.diagnostic.standing": "de pie",
  "motionReview.diagnostic.seated": "sentado",
  "motionReview.diagnostic.floor": "en el suelo",
  "motionReview.diagnostic.any": "en cualquier postura",
  "motionReview.fragment": "Fragmento aportado al prompt posterior. Otros nodos conectados y los ajustes de generación también afectan al prompt final.",
  "motionReview.attention": "Requiere atención:",
  "motionReview.sequenceWarning": "Revisa la secuencia:",
  "motionReview.requires": "Requiere:",
}
