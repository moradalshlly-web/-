// Portuguese (Brazil) chrome dictionary — empty by design: a partial dict is
// a first-class state. Missing keys fall back to English; the chrome-i18n
// coverage report (scripts/check-chrome-i18n-coverage.mjs) tracks the gap.
import type { ChromeDict } from "./en"

export const ptBR: ChromeDict = {
  "motionReview.diagnostic.capacity": "Apenas as primeiras {max} seleções são consideradas. Remova as seleções extras.",
  "motionReview.diagnostic.unknown": "O movimento “{motion}” não está disponível e não contribui com nenhum fragmento. Remova-o ou substitua-o.",
  "motionReview.diagnostic.omitted": "Omitido devido a um menor de idade conectado: {motions}. Substitua essas seleções.",
  "motionReview.diagnostic.omittedAll": "Omitido devido a um menor de idade conectado: {motions}. Nenhum movimento selecionado contribui com um fragmento.",
  "motionReview.diagnostic.multipleTargets": "Cada Target executa uma cópia separada da sequência. Use nós de movimento separados para coreografia coordenada.",
  "motionReview.diagnostic.roles": "A mesma referência está conectada como Target e como Partner. Conecte participantes distintos antes de executar esta interação.",
  "motionReview.diagnostic.retired": "{motion} foi descontinuado para novas seleções, mas ainda é resolvido em workflows salvos.",
  "motionReview.diagnostic.replacement": "Use {motion}.",
  "motionReview.diagnostic.pace": "{motion} define o próprio ritmo. Defina Pace como Auto ou substitua o movimento.",
  "motionReview.diagnostic.requirements": "{motion} requer: {requirements}.",
  "motionReview.diagnostic.partnerReference": "Referência Partner: {names}; confirme se corresponde ao destinatário esperado.",
  "motionReview.diagnostic.partnerFallback": "Conecte uma referência Partner para identificar o destinatário; caso contrário, o modelo escolherá.",
  "motionReview.diagnostic.sceneRequirements": "Defina isso na cena ou no prompt; o fragmento não fornece mídia de referência.",
  "motionReview.diagnostic.visibility": "{before} termina fora do quadro antes de {after}. Reordene ou adicione uma entrada.",
  "motionReview.diagnostic.pose": "{before} termina {fromPose}; {after} começa {toPose}. Adicione uma transição ou substitua um movimento.",
  "motionReview.diagnostic.hands": "{before} deixa as mãos ocupadas; {after} precisa das mãos livres. Adicione primeiro uma ação de soltar.",
  "motionReview.diagnostic.compound": "Seleções compostas: {count}. Clipes curtos podem não comportar todas as fases; teste a sequência antes de adicionar mais ações.",
  "motionReview.diagnostic.standing": "em pé",
  "motionReview.diagnostic.seated": "sentado",
  "motionReview.diagnostic.floor": "no chão",
  "motionReview.diagnostic.any": "em qualquer postura",
  "motionReview.fragment": "Fragmento adicionado ao prompt seguinte. Outros nós conectados e as configurações de geração também afetam o prompt final.",
  "motionReview.attention": "Requer atenção:",
  "motionReview.sequenceWarning": "Verifique a sequência:",
  "motionReview.requires": "Requer:",
}
