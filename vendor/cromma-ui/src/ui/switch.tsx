/**
 * [INPUT]: 依赖 radix-ui 的 Switch（空格/回车切换、switch 语义、受控 checked），react 的 forwardRef，.cn 的 cn。
 * [OUTPUT]: 提供 SwitchProps 与 Switch。checked / onCheckedChange 受控，透传 aria-label 等按钮属性。
 * [POS]: cromma-ui的开关——与 Checkbox 同一套选中语言：开为前景实底配底色滑块，关为发丝底槽配次级前景滑块（明暗两套主题都可辨），焦点环同为 ring-primary/40；滑块位移读 Tailwind 缺省过渡（即 --motion-quick 与 ease-motion）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { cn } from '../cn';

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'checked' | 'defaultChecked' | 'value'> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch({ className, checked, defaultChecked, disabled, onCheckedChange, ...rest }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      checked={checked}
      defaultChecked={defaultChecked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      className={cn(
        'inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border bg-muted p-0.5 outline-none transition-colors',
        'data-[state=checked]:border-foreground data-[state=checked]:bg-foreground',
        'focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...rest}
    >
      <SwitchPrimitive.Thumb className="block size-3.5 rounded-full bg-muted-foreground shadow-sm transition-[transform,background-color] data-[state=checked]:translate-x-4 data-[state=checked]:bg-background" />
    </SwitchPrimitive.Root>
  );
});
