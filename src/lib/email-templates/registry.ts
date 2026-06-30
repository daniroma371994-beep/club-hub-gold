import type { ComponentType } from 'react'
import { template as welcomeUserTemplate } from './welcome-user'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  to?: string
}

export const TEMPLATES: Record<string, TemplateEntry> = {
  'welcome-user': welcomeUserTemplate,
}
