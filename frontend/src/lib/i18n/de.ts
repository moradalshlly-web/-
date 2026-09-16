// German chrome dictionary — empty by design: a partial dict is a
// first-class state. Missing keys fall back to English; the chrome-i18n
// coverage report (scripts/check-chrome-i18n-coverage.mjs) tracks the gap.
import type { ChromeDict } from "./en"

export const de: ChromeDict = {
  "motionReview.diagnostic.capacity": "Nur die ersten {max} Auswahlen fließen ein. Entferne die überzähligen Auswahlen.",
  "motionReview.diagnostic.unknown": "Bewegung „{motion}“ ist nicht verfügbar und liefert kein Fragment. Entferne oder ersetze sie.",
  "motionReview.diagnostic.omitted": "Wegen einer verbundenen minderjährigen Person ausgelassen: {motions}. Ersetze diese Auswahlen.",
  "motionReview.diagnostic.omittedAll": "Wegen einer verbundenen minderjährigen Person ausgelassen: {motions}. Keine gewählte Bewegung liefert ein Fragment.",
  "motionReview.diagnostic.multipleTargets": "Jedes Target führt eine eigene Kopie der Sequenz aus. Verwende für koordinierte Choreografie separate Bewegungs-Nodes.",
  "motionReview.diagnostic.roles": "Dieselbe Referenz ist als Target und als Partner verbunden. Verbinde unterschiedliche Teilnehmer, bevor du diese Interaktion ausführst.",
  "motionReview.diagnostic.retired": "{motion} steht für neue Auswahlen nicht mehr zur Verfügung, wird in gespeicherten Workflows aber weiterhin aufgelöst.",
  "motionReview.diagnostic.replacement": "Verwende {motion}.",
  "motionReview.diagnostic.pace": "{motion} bestimmt das Timing selbst. Setze Pace auf Auto oder ersetze die Bewegung.",
  "motionReview.diagnostic.requirements": "{motion} erfordert: {requirements}.",
  "motionReview.diagnostic.partnerReference": "Partner-Referenz: {names}; prüfe, ob sie dem vorgesehenen Empfänger entspricht.",
  "motionReview.diagnostic.partnerFallback": "Verbinde eine Partner-Referenz, um den Empfänger festzulegen; andernfalls wählt ihn das Modell.",
  "motionReview.diagnostic.sceneRequirements": "Lege dies in der Szene oder im Prompt fest; das Fragment liefert keine Referenzmedien.",
  "motionReview.diagnostic.visibility": "{before} endet außerhalb des Bildes vor {after}. Ändere die Reihenfolge oder füge einen Auftritt hinzu.",
  "motionReview.diagnostic.pose": "{before} endet {fromPose}; {after} beginnt {toPose}. Füge einen Übergang hinzu oder ersetze eine Bewegung.",
  "motionReview.diagnostic.hands": "{before} lässt die Hände belegt; {after} braucht freie Hände. Füge zuerst ein Loslassen hinzu.",
  "motionReview.diagnostic.compound": "Zusammengesetzte Auswahlen: {count}. Kurze Clips fassen möglicherweise nicht jede Phase; teste die Sequenz, bevor du weitere Aktionen hinzufügst.",
  "motionReview.diagnostic.standing": "stehend",
  "motionReview.diagnostic.seated": "sitzend",
  "motionReview.diagnostic.floor": "auf dem Boden",
  "motionReview.diagnostic.any": "in beliebiger Haltung",
  "motionReview.fragment": "Fragment, das in den nachgelagerten Prompt einfließt. Andere verbundene Nodes und die Generierungseinstellungen beeinflussen den endgültigen Prompt ebenfalls.",
  "motionReview.attention": "Bitte prüfen:",
  "motionReview.sequenceWarning": "Reihenfolge prüfen:",
  "motionReview.requires": "Benötigt:",
}
