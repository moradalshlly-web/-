// Hindi chrome dictionary — empty by design: a partial dict is a
// first-class state. Missing keys fall back to English; the chrome-i18n
// coverage report (scripts/check-chrome-i18n-coverage.mjs) tracks the gap.
import type { ChromeDict } from "./en"

export const hi: ChromeDict = {
  "motionReview.diagnostic.capacity": "केवल पहले {max} चयन ही शामिल होते हैं। अतिरिक्त चयन हटाएँ।",
  "motionReview.diagnostic.unknown": "मोशन “{motion}” उपलब्ध नहीं है और कोई फ़्रैगमेंट नहीं जोड़ता। इसे हटाएँ या बदलें।",
  "motionReview.diagnostic.omitted": "जुड़े हुए नाबालिग के कारण छोड़ा गया: {motions}। इन चयनों को बदलें।",
  "motionReview.diagnostic.omittedAll": "जुड़े हुए नाबालिग के कारण छोड़ा गया: {motions}। चयनित कोई भी मोशन फ़्रैगमेंट नहीं जोड़ता।",
  "motionReview.diagnostic.multipleTargets": "हर Target सीक्वेंस की अलग प्रति करता है। समन्वित कोरियोग्राफी के लिए अलग-अलग मोशन नोड इस्तेमाल करें।",
  "motionReview.diagnostic.roles": "एक ही रेफ़रेंस Target और Partner दोनों के रूप में जुड़ा है। यह इंटरैक्शन चलाने से पहले अलग-अलग प्रतिभागी जोड़ें।",
  "motionReview.diagnostic.retired": "{motion} नए चयनों में उपलब्ध नहीं है, लेकिन सहेजे गए वर्कफ़्लो में अब भी काम करता है।",
  "motionReview.diagnostic.replacement": "{motion} इस्तेमाल करें।",
  "motionReview.diagnostic.pace": "{motion} अपनी टाइमिंग खुद तय करता है। Pace को Auto पर सेट करें या मोशन बदलें।",
  "motionReview.diagnostic.requirements": "{motion} के लिए आवश्यक: {requirements}।",
  "motionReview.diagnostic.partnerReference": "Partner रेफ़रेंस: {names}; पुष्टि करें कि यह अपेक्षित प्राप्तकर्ता से मेल खाता है।",
  "motionReview.diagnostic.partnerFallback": "प्राप्तकर्ता की पहचान के लिए Partner रेफ़रेंस जोड़ें; अन्यथा मॉडल उसे चुनेगा।",
  "motionReview.diagnostic.sceneRequirements": "इन्हें सीन या प्रॉम्प्ट में स्थापित करें; फ़्रैगमेंट रेफ़रेंस मीडिया नहीं देता।",
  "motionReview.diagnostic.visibility": "{before} फ़्रेम से बाहर समाप्त होता है, फिर {after} आता है। क्रम बदलें या एक प्रवेश जोड़ें।",
  "motionReview.diagnostic.pose": "{before} {fromPose} समाप्त होता है; {after} {toPose} शुरू होता है। ट्रांज़िशन जोड़ें या कोई मोशन बदलें।",
  "motionReview.diagnostic.hands": "{before} के बाद हाथ व्यस्त रहते हैं; {after} के लिए खाली हाथ चाहिए। पहले छोड़ने की क्रिया जोड़ें।",
  "motionReview.diagnostic.compound": "संयुक्त चयन: {count}। छोटे क्लिप में हर चरण नहीं समा सकता; और क्रियाएँ जोड़ने से पहले सीक्वेंस की जाँच करें।",
  "motionReview.diagnostic.standing": "खड़े होकर",
  "motionReview.diagnostic.seated": "बैठे हुए",
  "motionReview.diagnostic.floor": "फ़र्श पर",
  "motionReview.diagnostic.any": "किसी भी मुद्रा में",
  "motionReview.fragment": "डाउनस्ट्रीम प्रॉम्प्ट में जोड़ा गया अंश। अन्य जुड़े हुए नोड और जनरेशन सेटिंग्स भी अंतिम प्रॉम्प्ट को प्रभावित करती हैं।",
  "motionReview.attention": "ध्यान दें:",
  "motionReview.sequenceWarning": "क्रम जाँचें:",
  "motionReview.requires": "आवश्यक:",
}
