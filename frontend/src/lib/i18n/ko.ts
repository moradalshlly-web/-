// Korean chrome dictionary — empty by design: a partial dict is a
// first-class state. Missing keys fall back to English; the chrome-i18n
// coverage report (scripts/check-chrome-i18n-coverage.mjs) tracks the gap.
import type { ChromeDict } from "./en"

export const ko: ChromeDict = {
  "motionReview.diagnostic.capacity": "처음 {max}개의 선택만 반영됩니다. 초과된 선택을 제거하세요.",
  "motionReview.diagnostic.unknown": "모션 “{motion}”은(는) 사용할 수 없으며 프래그먼트를 생성하지 않습니다. 제거하거나 교체하세요.",
  "motionReview.diagnostic.omitted": "연결된 미성년자로 인해 제외됨: {motions}. 이 선택을 교체하세요.",
  "motionReview.diagnostic.omittedAll": "연결된 미성년자로 인해 제외됨: {motions}. 선택한 모션 중 프래그먼트를 생성하는 것이 없습니다.",
  "motionReview.diagnostic.multipleTargets": "각 Target이 시퀀스를 개별적으로 수행합니다. 조율된 안무에는 별도의 모션 노드를 사용하세요.",
  "motionReview.diagnostic.roles": "동일한 레퍼런스가 Target과 Partner로 모두 연결되어 있습니다. 이 인터랙션을 실행하기 전에 서로 다른 참여자를 연결하세요.",
  "motionReview.diagnostic.retired": "{motion}은(는) 새 선택에서 더 이상 제공되지 않지만 저장된 워크플로에서는 계속 적용됩니다.",
  "motionReview.diagnostic.replacement": "{motion}을(를) 사용하세요.",
  "motionReview.diagnostic.pace": "{motion}은(는) 자체 타이밍을 사용합니다. Pace를 Auto로 설정하거나 모션을 교체하세요.",
  "motionReview.diagnostic.requirements": "{motion}에 필요한 항목: {requirements}.",
  "motionReview.diagnostic.partnerReference": "Partner 레퍼런스: {names}. 필요한 상대와 일치하는지 확인하세요.",
  "motionReview.diagnostic.partnerFallback": "상대를 지정하려면 Partner 레퍼런스를 연결하세요. 연결하지 않으면 모델이 선택합니다.",
  "motionReview.diagnostic.sceneRequirements": "이 항목은 장면이나 프롬프트에서 설정하세요. 프래그먼트는 레퍼런스 미디어를 제공하지 않습니다.",
  "motionReview.diagnostic.visibility": "{before}이(가) {after} 전에 프레임 밖에서 끝납니다. 순서를 바꾸거나 등장을 추가하세요.",
  "motionReview.diagnostic.pose": "{before}은(는) {fromPose} 끝나고 {after}은(는) {toPose} 시작합니다. 전환을 추가하거나 모션을 교체하세요.",
  "motionReview.diagnostic.hands": "{before} 후에는 양손이 사용 중이지만 {after}에는 빈손이 필요합니다. 먼저 놓는 동작을 추가하세요.",
  "motionReview.diagnostic.compound": "복합 선택: {count}개. 짧은 클립에는 모든 단계가 담기지 않을 수 있습니다. 액션을 더 추가하기 전에 시퀀스를 테스트하세요.",
  "motionReview.diagnostic.standing": "선 자세로",
  "motionReview.diagnostic.seated": "앉은 자세로",
  "motionReview.diagnostic.floor": "바닥에서",
  "motionReview.diagnostic.any": "아무 자세로나",
  "motionReview.fragment": "다운스트림 프롬프트에 추가되는 프래그먼트입니다. 연결된 다른 노드와 생성 설정도 최종 프롬프트에 영향을 줍니다.",
  "motionReview.attention": "확인 필요:",
  "motionReview.sequenceWarning": "순서 확인:",
  "motionReview.requires": "필요:",
}
