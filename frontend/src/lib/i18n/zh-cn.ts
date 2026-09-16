// Chinese (Simplified) chrome dictionary — empty by design: a partial dict
// is a first-class state. Missing keys fall back to English; the chrome-i18n
// coverage report (scripts/check-chrome-i18n-coverage.mjs) tracks the gap.
import type { ChromeDict } from "./en"

export const zhCN: ChromeDict = {
  "motionReview.diagnostic.capacity": "仅前 {max} 项选择会生效。请移除多余的选择。",
  "motionReview.diagnostic.unknown": "动作“{motion}”不可用，不会生成片段。请移除或替换它。",
  "motionReview.diagnostic.omitted": "因连接了未成年人而省略：{motions}。请替换这些选择。",
  "motionReview.diagnostic.omittedAll": "因连接了未成年人而省略：{motions}。所选动作均不会生成片段。",
  "motionReview.diagnostic.multipleTargets": "每个 Target 都会单独执行一份序列。如需协调编排，请使用独立的动作节点。",
  "motionReview.diagnostic.roles": "同一个参考同时连接为 Target 和 Partner。请先连接不同的参与者，再运行此互动。",
  "motionReview.diagnostic.retired": "{motion} 已不再提供给新选择，但在已保存的工作流中仍可解析。",
  "motionReview.diagnostic.replacement": "请使用 {motion}。",
  "motionReview.diagnostic.pace": "{motion} 有自己的节奏。请将 Pace 设为 Auto，或替换该动作。",
  "motionReview.diagnostic.requirements": "{motion} 需要：{requirements}。",
  "motionReview.diagnostic.partnerReference": "Partner 参考：{names}；请确认与所需的接收者一致。",
  "motionReview.diagnostic.partnerFallback": "请连接 Partner 参考以指定接收者；否则由模型自行选择。",
  "motionReview.diagnostic.sceneRequirements": "请在场景或提示词中设定这些内容；片段不提供参考媒体。",
  "motionReview.diagnostic.visibility": "{before} 在 {after} 之前结束于画面之外。请调整顺序或添加入场。",
  "motionReview.diagnostic.pose": "{before} 以{fromPose}结束；{after} 以{toPose}开始。请添加过渡或替换某个动作。",
  "motionReview.diagnostic.hands": "{before} 结束后双手被占用；{after} 需要双手空闲。请先添加放开的动作。",
  "motionReview.diagnostic.compound": "复合选择：{count} 项。短片段可能容纳不下所有阶段；请先测试序列，再添加更多动作。",
  "motionReview.diagnostic.standing": "站姿",
  "motionReview.diagnostic.seated": "坐姿",
  "motionReview.diagnostic.floor": "在地面上",
  "motionReview.diagnostic.any": "任意姿势",
  "motionReview.fragment": "添加到下游提示词的片段。其他已连接的节点和生成设置也会影响最终提示词。",
  "motionReview.attention": "需要注意：",
  "motionReview.sequenceWarning": "请检查顺序：",
  "motionReview.requires": "需要：",
}
