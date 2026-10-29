/**
 * [INPUT]: Existing vendored Pika icons and the established usage/risk glyphs.
 * [OUTPUT]: One page-to-icon mapping shared by sidebar navigation and quick setup.
 * [POS]: Presentation only; no additional icon library or interaction behavior.
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
import {ShieldCheck, HomeDefault, WindowBrowser, Server, Share01, FolderDefault, Settings01} from 'cromma-ui/pika';
import type {Page} from './navigation';

const UsageIcon: typeof HomeDefault = ({size = 18, ...props}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M4 4v16h16M8 15v-4m5 4V6m5 9V9" />
  </svg>
);

const RiskIcon: typeof HomeDefault = ({size = 18, ...props}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3.5V6m0 12v2.5M3.5 12H6m12 0h2.5" />
  </svg>
);

export const pageIcons: Record<Page, typeof HomeDefault> = {
  quick: HomeDefault,
  cleaner: ShieldCheck,
  usage: UsageIcon,
  browser: WindowBrowser,
  system: Server,
  vps: Share01,
  risk: RiskIcon,
  help: FolderDefault,
  settings: Settings01,
};
