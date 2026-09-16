// Japanese chrome dictionary — empty by design: a partial dict is a
// first-class state. Missing keys fall back to English; the chrome-i18n
// coverage report (scripts/check-chrome-i18n-coverage.mjs) tracks the gap.
import type { ChromeDict } from "./en"

export const ja: ChromeDict = {
  "motionReview.diagnostic.capacity": "最初の {max} 件の選択のみが反映されます。余分な選択を削除してください。",
  "motionReview.diagnostic.unknown": "モーション「{motion}」は利用できず、フラグメントを生成しません。削除するか置き換えてください。",
  "motionReview.diagnostic.omitted": "接続された未成年者のため除外されました: {motions}。これらの選択を置き換えてください。",
  "motionReview.diagnostic.omittedAll": "接続された未成年者のため除外されました: {motions}。選択したモーションはいずれもフラグメントを生成しません。",
  "motionReview.diagnostic.multipleTargets": "各 Target がシーケンスを個別に実行します。連携した振り付けには別々のモーションノードを使用してください。",
  "motionReview.diagnostic.roles": "同じリファレンスが Target と Partner の両方に接続されています。このインタラクションを実行する前に、異なる参加者を接続してください。",
  "motionReview.diagnostic.retired": "{motion} は新規選択では廃止されましたが、保存済みワークフローでは引き続き解決されます。",
  "motionReview.diagnostic.replacement": "{motion} を使用してください。",
  "motionReview.diagnostic.pace": "{motion} は独自のタイミングを持ちます。Pace を Auto に設定するか、モーションを置き換えてください。",
  "motionReview.diagnostic.requirements": "{motion} に必要なもの: {requirements}。",
  "motionReview.diagnostic.partnerReference": "Partner リファレンス: {names}。必要な相手と一致しているか確認してください。",
  "motionReview.diagnostic.partnerFallback": "相手を指定するには Partner リファレンスを接続してください。未接続の場合はモデルが選択します。",
  "motionReview.diagnostic.sceneRequirements": "これらはシーンまたはプロンプトで設定してください。フラグメントはリファレンスメディアを提供しません。",
  "motionReview.diagnostic.visibility": "{before} は {after} の前にフレーム外で終了します。順序を変更するか、登場を追加してください。",
  "motionReview.diagnostic.pose": "{before} は{fromPose}終わり、{after} は{toPose}始まります。トランジションを追加するか、モーションを置き換えてください。",
  "motionReview.diagnostic.hands": "{before} の後は両手がふさがったままですが、{after} には空いた手が必要です。先に手を離す動作を追加してください。",
  "motionReview.diagnostic.compound": "複合選択: {count} 件。短いクリップではすべての段階が収まらない場合があります。アクションを追加する前にシーケンスをテストしてください。",
  "motionReview.diagnostic.standing": "立った状態で",
  "motionReview.diagnostic.seated": "座った状態で",
  "motionReview.diagnostic.floor": "床の上で",
  "motionReview.diagnostic.any": "任意の姿勢で",
  "motionReview.fragment": "下流のプロンプトに追加されるフラグメントです。接続されている他のノードや生成設定も最終的なプロンプトに影響します。",
  "motionReview.attention": "要確認：",
  "motionReview.sequenceWarning": "順序を確認：",
  "motionReview.requires": "必要：",
}
