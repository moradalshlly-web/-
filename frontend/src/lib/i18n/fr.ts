// French chrome dictionary — empty by design: a partial dict is a
// first-class state. Missing keys fall back to English; the chrome-i18n
// coverage report (scripts/check-chrome-i18n-coverage.mjs) tracks the gap.
import type { ChromeDict } from "./en"

export const fr: ChromeDict = {
  "motionReview.diagnostic.capacity": "Seules les {max} premières sélections sont prises en compte. Supprimez les sélections en trop.",
  "motionReview.diagnostic.unknown": "Le mouvement « {motion} » est indisponible et n'apporte aucun fragment. Supprimez-le ou remplacez-le.",
  "motionReview.diagnostic.omitted": "Omis en raison d'un mineur connecté : {motions}. Remplacez ces sélections.",
  "motionReview.diagnostic.omittedAll": "Omis en raison d'un mineur connecté : {motions}. Aucun mouvement sélectionné n'apporte de fragment.",
  "motionReview.diagnostic.multipleTargets": "Chaque Target exécute sa propre copie de la séquence. Utilisez des nœuds de mouvement distincts pour une chorégraphie coordonnée.",
  "motionReview.diagnostic.roles": "La même référence est connectée à la fois comme Target et comme Partner. Connectez des participants distincts avant de lancer cette interaction.",
  "motionReview.diagnostic.retired": "{motion} n'est plus proposé dans les nouvelles sélections, mais reste résolu dans les workflows enregistrés.",
  "motionReview.diagnostic.replacement": "Utilisez {motion}.",
  "motionReview.diagnostic.pace": "{motion} impose son propre rythme. Réglez Pace sur Auto ou remplacez le mouvement.",
  "motionReview.diagnostic.requirements": "{motion} requiert : {requirements}.",
  "motionReview.diagnostic.partnerReference": "Référence Partner : {names} ; vérifiez qu'elle correspond au destinataire attendu.",
  "motionReview.diagnostic.partnerFallback": "Connectez une référence Partner pour identifier le destinataire ; sinon, le modèle le choisira.",
  "motionReview.diagnostic.sceneRequirements": "Établissez ces éléments dans la scène ou le prompt ; le fragment ne fournit pas de média de référence.",
  "motionReview.diagnostic.visibility": "{before} se termine hors champ avant {after}. Réordonnez ou ajoutez une entrée.",
  "motionReview.diagnostic.pose": "{before} se termine {fromPose} ; {after} commence {toPose}. Ajoutez une transition ou remplacez un mouvement.",
  "motionReview.diagnostic.hands": "{before} laisse les mains occupées ; {after} nécessite les mains libres. Ajoutez d'abord un lâcher.",
  "motionReview.diagnostic.compound": "Sélections composées : {count}. Les clips courts peuvent ne pas contenir toutes les phases ; testez la séquence avant d'ajouter d'autres actions.",
  "motionReview.diagnostic.standing": "debout",
  "motionReview.diagnostic.seated": "assis",
  "motionReview.diagnostic.floor": "au sol",
  "motionReview.diagnostic.any": "dans n'importe quelle posture",
  "motionReview.fragment": "Fragment ajouté au prompt en aval. Les autres nœuds connectés et les réglages de génération influencent aussi le prompt final.",
  "motionReview.attention": "À vérifier :",
  "motionReview.sequenceWarning": "Vérifiez la séquence :",
  "motionReview.requires": "Requiert :",
}
