/*
 * [INPUT]: LaunchServices 参数、宿主写入的 launch.args 与身份切换阻断文件；新宿主必须发布本次启动参数。
 * [OUTPUT]: 宿主 Claude-Local 未运行时在后台带起它；读取宿主写入的 start.url（宿主刚启动时最多等 8 秒，并确认回环端口可连），
 *           作为首个标签追加在参数末尾；随后以原进程编号 exec 同目录的 Chromium。链接打开经 Apple Event 送达，不受影响。
 * [POS]: Claude-Local Browser 应用包的 CFBundleExecutable。宿主直接启动 Contents/MacOS/Chromium，不经过本入口。
 *        已带 --user-data-dir 时不注入参数；不读取、不修改浏览器资料。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#include <arpa/inet.h>
#include <libproc.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <time.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc_info.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#define HOST_ID "ai.local.claude-local"
#define HOST_SUFFIX ".app/Contents/MacOS/claude-local"

static int host_running(void) {
    int count = proc_listallpids(NULL, 0);
    if (count <= 0) return 0;
    pid_t *pids = calloc((size_t)count + 64, sizeof(pid_t));
    if (!pids) return 0;
    count = proc_listallpids(pids, (int)((count + 64) * sizeof(pid_t)));
    int found = 0;
    for (int i = 0; i < count && !found; i++) {
        char path[PROC_PIDPATHINFO_MAXSIZE];
        struct proc_bsdinfo info;
        if (pids[i] <= 1 || proc_pidpath(pids[i], path, sizeof(path)) <= 0) continue;
        size_t n = strlen(path), m = strlen(HOST_SUFFIX);
        if (n < m || strcmp(path + n - m, HOST_SUFFIX) != 0) continue;
        if (proc_pidinfo(pids[i], PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != sizeof(info)) continue;
        if (info.pbi_uid == getuid()) found = 1;
    }
    free(pids);
    return found;
}

/* 双重 fork：open 进程不成为 Chromium 的子进程，避免僵尸。 */
static void launch_host(const char *apps_dir) {
    char host[PATH_MAX];
    struct stat st;
    snprintf(host, sizeof(host), "%s/Claude-Local.app", apps_dir);
    int by_path = stat(host, &st) == 0 && S_ISDIR(st.st_mode);
    pid_t child = fork();
    if (child < 0) return;
    if (child == 0) {
        if (fork() == 0) {
            if (by_path) execl("/usr/bin/open", "open", "-g", "-a", host, (char *)NULL);
            execl("/usr/bin/open", "open", "-g", "-b", HOST_ID, (char *)NULL);
            _exit(127);
        }
        _exit(0);
    }
    waitpid(child, NULL, 0);
}

/* 起始页地址仅在宿主运行期间有效：读取 start.url，要求（宿主新启动时）文件晚于本次启动写入，且回环端口可连。 */
static char *start_page(const char *home, int fresh_host, time_t began) {
    char file[PATH_MAX];
    snprintf(file, sizeof(file), "%s/Library/Application Support/" HOST_ID "/browser/start.url", home);
    int waits = fresh_host ? 80 : 20; /* 100ms 一次：新启动宿主 8 秒，已运行宿主 2 秒 */
    for (int i = 0; i < waits; i++) {
        struct stat st;
        if (stat(file, &st) == 0 && (!fresh_host || st.st_mtimespec.tv_sec >= began)) {
            FILE *f = fopen(file, "r");
            char line[1024] = {0};
            if (f) { if (!fgets(line, sizeof(line), f)) line[0] = 0; fclose(f); }
            line[strcspn(line, "\r\n")] = 0;
            int port = 0;
            if (sscanf(line, "http://127.0.0.1:%d/", &port) == 1 && port > 0 && port < 65536) {
                int fd = socket(AF_INET, SOCK_STREAM, 0);
                struct sockaddr_in addr = {0};
                addr.sin_family = AF_INET;
                addr.sin_port = htons((unsigned short)port);
                addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
                int ok = fd >= 0 && connect(fd, (struct sockaddr *)&addr, sizeof(addr)) == 0;
                if (fd >= 0) close(fd);
                if (ok) return strdup(line);
            }
        }
        usleep(100 * 1000);
    }
    return NULL;
}

int main(int argc, char **argv) {
    time_t began = time(NULL);
    char raw[PATH_MAX], exe[PATH_MAX];
    uint32_t size = sizeof(raw);
    if (_NSGetExecutablePath(raw, &size) != 0 || !realpath(raw, exe)) return 1;
    char *slash = strrchr(exe, '/');
    if (!slash) return 1;
    *slash = 0; /* exe = .../Claude-Local Browser.app/Contents/MacOS */
    char real[PATH_MAX];
    snprintf(real, sizeof(real), "%s/Chromium", exe);
    char apps[PATH_MAX];
    snprintf(apps, sizeof(apps), "%s", exe);
    for (int up = 0; up < 3; up++) { char *s = strrchr(apps, '/'); if (s) *s = 0; }

    int fresh_host = !host_running();
    if (fresh_host) launch_host(apps);

    int has_profile = 0;
    for (int i = 1; i < argc; i++)
        if (strncmp(argv[i], "--user-data-dir", 15) == 0) has_profile = 1;

    char **next = calloc((size_t)argc + 256, sizeof(char *));
    if (!next) return 1;
    int n = 0;
    next[n++] = real;
    if (!has_profile) {
        const char *home = getenv("HOME");
        char file[PATH_MAX];
        snprintf(file, sizeof(file), "%s/Library/Application Support/" HOST_ID "/browser/launch.args", home ? home : "");
        char pending[PATH_MAX];
        snprintf(pending, sizeof(pending), "%s/Library/Application Support/" HOST_ID "/browser/identity-switch.pending", home ? home : "");
        struct stat args_stat;
        int ready = 0;
        for (int attempt = 0; attempt < 80; attempt++) {
            if (access(pending, F_OK) != 0 && stat(file, &args_stat) == 0 && (!fresh_host || args_stat.st_mtime >= began)) { ready = 1; break; }
            usleep(100 * 1000);
        }
        if (!ready) { fputs("Claude-Local Browser: 等待宿主完成身份资料选择，请在主应用中恢复或重试。\n", stderr); return 1; }
        FILE *f = fopen(file, "r");
        if (!f) {
            /* 不回退到其他资料，避免联动身份与网页登录错位。 */
            return 1;
        }
        if (f) {
            char line[8192];
            while (n < 240 && fgets(line, sizeof(line), f)) {
                line[strcspn(line, "\r\n")] = 0;
                if (strncmp(line, "--", 2) == 0) next[n++] = strdup(line);
            }
            fclose(f);
        }
    }
    int has_url = 0;
    for (int i = 1; i < argc; i++) {
        next[n++] = argv[i];
        if (strncmp(argv[i], "http", 4) == 0 || strncmp(argv[i], "file:", 5) == 0) has_url = 1;
    }
    /* 全新启动（非宿主直接带资料参数启动）时，实测页作为首个标签；命令行已带网址时排在其后。 */
    if (!has_profile) {
        const char *home = getenv("HOME");
        char *page = start_page(home ? home : "", fresh_host, began);
        if (page) {
            if (has_url) {
                /* 把实测页插到第一个网址之前，使其成为首个标签。 */
                int first = 1;
                while (first < n && strncmp(next[first], "http", 4) != 0 && strncmp(next[first], "file:", 5) != 0) first++;
                for (int k = n; k > first; k--) next[k] = next[k - 1];
                next[first] = page;
                n++;
            } else {
                next[n++] = page;
            }
        }
    }
    next[n] = NULL;
    execv(real, next);
    perror("Claude-Local Browser: 无法启动 Chromium");
    return 1;
}
