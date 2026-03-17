import { type HTMLAttributes, forwardRef } from 'react'

export interface DialogProps extends HTMLAttributes<HTMLDivElement> {
}

const Dialog = forwardRef<HTMLDivElement, DialogProps>(({ className, ...props }, ref) => (
  <div ref={ref} className={`dialog-content ${className || ''}`} {...props} />
))
Dialog.displayName = 'Dialog'

const DialogContent = forwardRef<HTMLDivElement, DialogProps>(({ className, ...props }, ref) => (
  <div ref={ref} className={`dialog-content ${className || ''}`} {...props} />
))
DialogContent.displayName = 'DialogContent'

const DialogHeader = forwardRef<HTMLDivElement, DialogProps>(({ className, ...props }, ref) => (
  <div ref={ref} className={`dialog-header ${className || ''}`} {...props} />
))
DialogHeader.displayName = 'DialogHeader'

const DialogTitle = forwardRef<HTMLDivElement, DialogProps>(({ className, ...props }, ref) => (
  <div ref={ref} className={`dialog-title ${className || ''}`} {...props} />
))
DialogTitle.displayName = 'DialogTitle'

const DialogDescription = forwardRef<HTMLDivElement, DialogProps>(({ className, ...props }, ref) => (
  <div ref={ref} className={`dialog-description ${className || ''}`} {...props} />
))
DialogDescription.displayName = 'DialogDescription'

const DialogActions = forwardRef<HTMLDivElement, DialogProps>(({ className, ...props }, ref) => (
  <div ref={ref} className={`dialog-actions ${className || ''}`} {...props} />
))
DialogActions.displayName = 'DialogActions'

const DialogTrigger = forwardRef<HTMLDivElement, DialogProps>(({ className, ...props }, ref) => (
  <div ref={ref} className={`dialog-trigger ${className || ''}`} {...props} />
))
DialogTrigger.displayName = 'DialogTrigger'

export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogActions, DialogTrigger }