/**
 * [INPUT]: 依赖 radix-ui 的 ToggleGroup（单选 radio 语义、方向键 roving focus），.cn 的 cn，control 的 SEGMENT_TRACK / SEGMENT_ITEM。
 * [OUTPUT]: 提供 SegmentedControl 与 SegmentedItem。items + value/onValueChange；size: small | medium；已选项再次点击不会清空。
 * [POS]: cromma-ui的分段单选——与 Tabs segmented 同一条轨道同一个滑块；Tabs 管换面板，SegmentedControl 管选值（主题、语言、视图口径）。行为归 Radix，这里只给长相。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ReactNode } from 'react';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { cn } from '../cn';
import { SEGMENT_ITEM, SEGMENT_TRACK } from './control';

export interface SegmentedItem<T extends string = string> {
  value: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({
  items,
  value,
  onValueChange,
  size = 'medium',
  disabled,
  className,
  itemClassName,
  'aria-label': ariaLabel,
}: {
  items: readonly SegmentedItem<T>[];
  value: T;
  onValueChange: (value: T) => void;
  size?: 'small' | 'medium';
  disabled?: boolean;
  className?: string;
  itemClassName?: string;
  'aria-label'?: string;
}) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      // Radix 单选再次点击已选项会回传空串：分段选择始终有值，空串直接忽略
      onValueChange={(next) => {
        if (next) onValueChange(next as T);
      }}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(SEGMENT_TRACK, className)}
    >
      {items.map((item) => (
        <ToggleGroupPrimitive.Item
          key={item.value}
          value={item.value}
          title={item.title}
          disabled={item.disabled}
          className={cn(
            SEGMENT_ITEM,
            'data-[state=on]:bg-card data-[state=on]:font-medium data-[state=on]:text-foreground data-[state=on]:shadow-sm',
            size === 'small' ? 'h-7 text-sm' : 'h-8',
            itemClassName,
          )}
        >
          {item.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}
