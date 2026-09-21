import { surfaceTabs, surfaceTemplatesVisible } from "@/lib/surface-selectors"
import { LevelUpSection } from "./level-up-section"
import { TemplateUseCasesSection } from "./template-use-cases-section"
import { YourPathSection } from "./your-path-section"

/**
 * The Explore tab. Each section follows its surface-profile key (home-tabs.ts);
 * the page hides the whole tab when neither key survives, so at least one of
 * the first two sections always renders. The first one carries the panel's
 * theme switch.
 */
export function ExploreTab() {
  const showTemplates = surfaceTemplatesVisible()
  const showTutorials = surfaceTabs(["tutorials"] as const).length > 0

  return (
    <>
      {showTemplates && <TemplateUseCasesSection withThemeSwitch />}
      {showTutorials && <LevelUpSection withThemeSwitch={!showTemplates} />}
      <YourPathSection />
    </>
  )
}
