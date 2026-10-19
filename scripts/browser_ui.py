# [INPUT]: Vite 生成的浏览器页面、入口脚本、预加载模块与样式资源目录。
# [OUTPUT]: verify_browser_ui 和只读 CLI 验证页面实际引用的本地文件。
# [POS]: 三平台安装/发布载荷与构建 CI 共用的资源边界；不执行页面或脚本。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


class _Resources(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []
        self.entry = False

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == 'script' and attrs.get('src'):
            self.references.append(attrs['src'])
            self.entry |= attrs.get('type') == 'module'
        if tag == 'link' and set((attrs.get('rel') or '').split()) & {'modulepreload', 'stylesheet'}:
            self.references.append(attrs.get('href') or '')


def verify_browser_ui(folder):
    try:
        root = Path(folder).resolve(strict=True)
        page = root / 'browser.html'
        if not page.resolve(strict=True).is_relative_to(root):
            raise ValueError('Linked entry outside resource directory')
        with page.open('rb') as stream:
            html = stream.read(2 * 1024 * 1024 + 1)
        if len(html) > 2 * 1024 * 1024:
            raise ValueError('Oversized browser entry')
        parser = _Resources()
        parser.feed(html.decode('utf-8'))
        parser.close()
        if not parser.entry:
            raise ValueError('Missing module entry')
        for reference in parser.references:
            url = urlsplit(reference)
            path = Path(unquote(url.path))
            if url.scheme or url.netloc or not url.path or path.is_absolute() or '\\' in url.path:
                raise ValueError('Non-local browser resource')
            resource = (root / path).resolve(strict=True)
            if not resource.is_relative_to(root) or not resource.is_file():
                raise ValueError('Missing or external browser resource')
    except (OSError, ValueError) as error:
        raise RuntimeError('Embedded browser UI resources missing or invalid') from error


if __name__ == '__main__':
    import sys
    verify_browser_ui(sys.argv[1])
