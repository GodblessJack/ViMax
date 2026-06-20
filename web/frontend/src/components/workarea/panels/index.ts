export { StoryResultPanel } from './StoryResultPanel'
export { CharacterResultPanel } from './CharacterResultPanel'
export { ScriptResultPanel } from './ScriptResultPanel'
export { StoryboardResultPanel } from './StoryboardResultPanel'
export { PortraitResultPanel } from './PortraitResultPanel'
export { VideoResultPanel } from './VideoResultPanel'

import type { WorkflowStepName } from '@/stores/types'

// STEP_RESULT_COMPONENTS maps each workflow step to its dedicated result panel.
// Uses dynamic imports to avoid bundling all panels into the initial chunk.
export const STEP_RESULT_COMPONENTS: Record<
  WorkflowStepName,
  React.ComponentType<{
    data: unknown
    onEdit?: (path: string, value: unknown) => void
  }>
> = {
  story_generation: (() =>
    import('./StoryResultPanel').then(
      (m) => ({ default: m.StoryResultPanel })
    )) as any,
  character_extraction: (() =>
    import('./CharacterResultPanel').then(
      (m) => ({ default: m.CharacterResultPanel })
    )) as any,
  script_writing: (() =>
    import('./ScriptResultPanel').then(
      (m) => ({ default: m.ScriptResultPanel })
    )) as any,
  storyboard_design: (() =>
    import('./StoryboardResultPanel').then(
      (m) => ({ default: m.StoryboardResultPanel })
    )) as any,
  character_portraits: (() =>
    import('./PortraitResultPanel').then(
      (m) => ({ default: m.PortraitResultPanel })
    )) as any,
  video_rendering: (() =>
    import('./VideoResultPanel').then(
      (m) => ({ default: m.VideoResultPanel })
    )) as any,
}
