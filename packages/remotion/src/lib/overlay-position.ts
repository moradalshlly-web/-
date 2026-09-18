export type OverlayPosition = "top" | "center" | "bottom"

/**
 * Inset of a caption BLOCK's near edge from the frame edge, for the named slots.
 * A top block grows DOWN from `top`; a bottom block grows UP from `bottom`;
 * `center` is a true centre. (These reuse the old centre-line percentages as
 * edges — see `captionAnchor` in caption-look.ts — so a large multi-line block
 * no longer clips off-screen, especially in landscape.)
 */
export const CAPTION_EDGE_INSET = { top: "12%", bottom: "18%" } as const
