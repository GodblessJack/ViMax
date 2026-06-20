import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Film } from 'lucide-react'

type EmptyStateProps = {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({
  icon, title, description, action, className,
}: EmptyStateProps) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-center py-16 px-4 text-center',
      className,
    )}>
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted mb-4">
        {icon || <Film className="h-8 w-8 text-muted-foreground" />}
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm mb-4">{description}</p>
      )}
      {action}
    </div>
  )
}
