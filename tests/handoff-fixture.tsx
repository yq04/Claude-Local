/**
 * [INPUT]: Tauri 官方 mockIPC 与 TaskHandoff 真实前端组件。
 * [OUTPUT]: 挂载有界手工交接组件，供无头浏览器验证文件输入、大小限制、纯文本预览与替换确认。
 * [POS]: 独立测试入口；没有原生命令、真实目录或网络，生产构建不打包本文件。
 * [PROTOCOL]: 变更时更新头部。
 */
import {createRoot} from 'react-dom/client';
import {mockIPC} from '@tauri-apps/api/mocks';
import {MotionRoot, TooltipProvider} from 'cromma-ui';
import {TaskHandoff} from '../src/task-handoff';
import '../src/index.css';
import '../src/style.css';
import '../src/productivity-shell.css';

mockIPC((cmd, args) => {
  if (cmd === 'copy_result') return null;
  return null;
});

const container = document.getElementById('fixture');
if (container) {
  const root = createRoot(container);
  root.render(
    <MotionRoot>
      <TooltipProvider>
        <TaskHandoff open={true} />
      </TooltipProvider>
    </MotionRoot>
  );
}
