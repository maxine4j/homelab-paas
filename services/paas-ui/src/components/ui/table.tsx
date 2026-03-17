import { type TableHTMLAttributes, forwardRef } from 'react'

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
}

const Table = forwardRef<HTMLTableElement, TableProps>(({ className, ...props }, ref) => (
  <table
    ref={ref}
    className={`table ${className || ''}`}
    {...props}
  />
))
Table.displayName = 'Table'

const TableHeader = forwardRef<HTMLTableSectionElement, TableHTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => (
  <thead ref={ref} className={`table-header ${className || ''}`} {...props} />
))
TableHeader.displayName = 'TableHeader'

const TableBody = forwardRef<HTMLTableSectionElement, TableHTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={`table-body ${className || ''}`} {...props} />
))
TableBody.displayName = 'TableBody'

const TableFooter = forwardRef<HTMLTableSectionElement, TableHTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => (
  <tfoot ref={ref} className={`table-footer ${className || ''}`} {...props} />
))
TableFooter.displayName = 'TableFooter'

const TableRow = forwardRef<HTMLTableRowElement, TableHTMLAttributes<HTMLTableRowElement>>(({ className, ...props }, ref) => (
  <tr ref={ref} className={`table-row ${className || ''}`} {...props} />
))
TableRow.displayName = 'TableRow'

const TableHead = forwardRef<HTMLTableHeaderCellElement, TableHTMLAttributes<HTMLTableHeaderCellElement>>(({ className, ...props }, ref) => (
  <th ref={ref} className={`table-head ${className || ''}`} {...props} />
))
TableHead.displayName = 'TableHead'

const TableCell = forwardRef<HTMLTableDataCellElement, TableHTMLAttributes<HTMLTableDataCellElement>>(({ className, ...props }, ref) => (
  <td ref={ref} className={`table-cell ${className || ''}`} {...props} />
))
TableCell.displayName = 'TableCell'

export { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell }