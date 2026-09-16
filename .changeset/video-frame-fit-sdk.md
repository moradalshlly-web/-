---
"@nodaro/sdk": minor
---

`nodes.run("generate-video", …)` gains typed `frameFit`, `frameDelivery` and `endFrameUrl` fields. `frameFit` resizes a start/end frame to the model's measured output canvas before dispatch (default), and `frameDelivery` chooses frame vs bound-reference delivery (default auto, per model).
