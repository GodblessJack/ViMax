import { lazy } from 'react'

export const StoryResultPanel = lazy(() =>
  import('./StoryResultPanel').then((m) => ({ default: m.StoryResultPanel }))
)
export const CharacterResultPanel = lazy(() =>
  import('./CharacterResultPanel').then((m) => ({ default: m.CharacterResultPanel }))
)
export const ScriptResultPanel = lazy(() =>
  import('./ScriptResultPanel').then((m) => ({ default: m.ScriptResultPanel }))
)
export const StoryboardResultPanel = lazy(() =>
  import('./StoryboardResultPanel').then((m) => ({ default: m.StoryboardResultPanel }))
)
export const PortraitResultPanel = lazy(() =>
  import('./PortraitResultPanel').then((m) => ({ default: m.PortraitResultPanel }))
)
export const VideoResultPanel = lazy(() =>
  import('./VideoResultPanel').then((m) => ({ default: m.VideoResultPanel }))
)

import type { WorkflowStepName } from '@/stores/types'

export const STEP_RESULT_COMPONENTS: Record<
  WorkflowStepName,
  React.LazyExoticComponent<
    React.ComponentType<{
      data: unknown
      onEdit?: (path: string, value: unknown) => void
    }>
  >
> = {
  story_generation: StoryResultPanel,
  character_extraction: CharacterResultPanel,
  script_writing: ScriptResultPanel,
  storyboard_design: StoryboardResultPanel,
  character_portraits: PortraitResultPanel,
  video_rendering: VideoResultPanel,
}
