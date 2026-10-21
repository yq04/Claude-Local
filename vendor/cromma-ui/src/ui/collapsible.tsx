/**
 * [INPUT]: 依赖 radix-ui 的 Collapsible（aria-expanded / aria-controls、受控或自管开合、关闭时等动画结束再卸载），.cn 的 cn，glyphs 的 ChevronGlyph；皮与关键帧在同位的 collapsible.css。
 * [OUTPUT]: 提供 Disclosure。summary 为触发行主体，aside 为行尾徽标，open/defaultOpen/onOpenChange 控制开合，className / triggerClassName / contentClassName 分别落在外壳、触发行与内容。
 * [POS]: cromma-ui的折叠区——应用内所有「点标题展开详情」只用这一件：同一个行尾箭头、同一条展开动效、同一套焦点环。行为归 Radix，这里只给长相。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ReactNode } from 'react';
import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import { cn } from '../cn';
import { ChevronGlyph } from './glyphs';
import './collapsible.css';

export function Disclosure({
  summary,
  aside,
  open,
  defaultOpen,
  onOpenChange,
  disabled,
  className,
  triggerClassName,
  contentClassName,
  children,
}: {
  summary: ReactNode;
  aside?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <CollapsiblePrimitive.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange} disabled={disabled} className={className}>
      <CollapsiblePrimitive.Trigger
        className={cn(
          'group flex w-full min-w-0 cursor-pointer items-center gap-2.5 text-left outline-none transition-colors',
          'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60',
          triggerClassName,
        )}
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">{summary}</span>
        {aside}
        <ChevronGlyph className="text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content className={cn('cromma-disclosure-content', contentClassName)}>{children}</CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}
