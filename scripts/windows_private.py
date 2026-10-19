#!/usr/bin/env python3
# [INPUT]: Windows 当前进程令牌、NTFS 安全描述符与本应用维护工具创建的子进程。
# [OUTPUT]: 仅当前用户可访问的私密文件 ACL、所有权核验及超时任务树回收。
# [POS]: Windows 私有文件标准库适配；不读取账户凭据、不枚举其他用户、不修改系统安全策略。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import ctypes as c
from ctypes import wintypes as w
from pathlib import Path

k = c.WinDLL('kernel32', use_last_error=True)
a = c.WinDLL('advapi32', use_last_error=True)
P = c.c_void_p
D = w.DWORD

def bind(lib, name, result, *args):
    fn = getattr(lib, name); fn.restype = result; fn.argtypes = args; return fn

current = bind(k, 'GetCurrentProcess', w.HANDLE)
close = bind(k, 'CloseHandle', w.BOOL, w.HANDLE)
free = bind(k, 'LocalFree', P, P)
open_token = bind(a, 'OpenProcessToken', w.BOOL, w.HANDLE, D, c.POINTER(w.HANDLE))
get_token = bind(a, 'GetTokenInformation', w.BOOL, w.HANDLE, c.c_int, P, D, c.POINTER(D))
string_sid = bind(a, 'ConvertSidToStringSidW', w.BOOL, P, c.POINTER(P))
convert = bind(a, 'ConvertStringSecurityDescriptorToSecurityDescriptorW', w.BOOL, w.LPCWSTR, D, c.POINTER(P), c.POINTER(D))
owner_of = bind(a, 'GetSecurityDescriptorOwner', w.BOOL, P, c.POINTER(P), c.POINTER(w.BOOL))
dacl_of = bind(a, 'GetSecurityDescriptorDacl', w.BOOL, P, c.POINTER(w.BOOL), c.POINTER(P), c.POINTER(w.BOOL))
get_security = bind(a, 'GetNamedSecurityInfoW', D, w.LPCWSTR, c.c_int, D, c.POINTER(P), P, c.POINTER(P), P, c.POINTER(P))
set_security = bind(a, 'SetNamedSecurityInfoW', D, w.LPWSTR, c.c_int, D, P, P, P, P)
equal_sid = bind(a, 'EqualSid', w.BOOL, P, P)
get_ace = bind(a, 'GetAce', w.BOOL, P, D, c.POINTER(P))

def fail():
    raise OSError('Windows private ACL or task isolation failed; no credentials printed')

def user_sid():
    token = w.HANDLE(); size = D()
    if not open_token(current(), 8, c.byref(token)): fail()
    try:
        get_token(token, 1, None, 0, c.byref(size))
        data = c.create_string_buffer(size.value)
        if not get_token(token, 1, data, size, c.byref(size)): fail()
        ptr = c.cast(data, c.POINTER(P))[0]; text = P()
        if not string_sid(ptr, c.byref(text)): fail()
        try: return c.wstring_at(text)
        finally: free(text)
    finally: close(token)

SID = user_sid()

def descriptor():
    result = P()
    if not convert(f'O:{SID}D:P(A;;FA;;;{SID})', 1, c.byref(result), None): fail()
    return result

def protect(path):
    sd = descriptor(); owner = P(); acl = P(); defaulted = w.BOOL(); present = w.BOOL()
    try:
        if not owner_of(sd, c.byref(owner), c.byref(defaulted)) or not dacl_of(sd, c.byref(present), c.byref(acl), c.byref(defaulted)): fail()
        if set_security(str(Path(path)), 1, 1 | 4 | 0x80000000, owner, None, acl, None): fail()
    finally: free(sd)
    assert_private(path)

class ACL(c.Structure):
    _fields_ = [('revision', w.BYTE), ('reserved', w.BYTE), ('size', w.WORD), ('count', w.WORD), ('reserved2', w.WORD)]

class ACE(c.Structure):
    _fields_ = [('kind', w.BYTE), ('flags', w.BYTE), ('size', w.WORD), ('mask', D), ('sid', D)]

def assert_private(path):
    sd = P(); owner = P(); acl = P(); expected = descriptor(); user = P(); defaulted = w.BOOL()
    try:
        if get_security(str(Path(path)), 1, 1 | 4, c.byref(owner), None, c.byref(acl), None, c.byref(sd)): fail()
        if not owner_of(expected, c.byref(user), c.byref(defaulted)) or not equal_sid(owner, user) or not acl: fail()
        if c.cast(acl, c.POINTER(ACL)).contents.count != 1: fail()
        entry = P()
        if not get_ace(acl, 0, c.byref(entry)): fail()
        ace = c.cast(entry, c.POINTER(ACE)).contents
        if ace.kind != 0 or ace.flags != 0 or ace.mask != 0x1f01ff or not equal_sid(P(entry.value + ACE.sid.offset), user): fail()
    finally:
        if sd: free(sd)
        free(expected)

class BasicLimit(c.Structure):
    _fields_ = [('process_time', c.c_int64), ('job_time', c.c_int64), ('flags', D), ('min_ws', c.c_size_t), ('max_ws', c.c_size_t), ('processes', D), ('affinity', c.c_size_t), ('priority', D), ('scheduling', D)]
class IO(c.Structure):
    _fields_ = [(name, c.c_uint64) for name in ('reads','writes','other','read_bytes','write_bytes','other_bytes')]
class Limits(c.Structure):
    _fields_ = [('basic', BasicLimit), ('io', IO), ('process_memory', c.c_size_t), ('job_memory', c.c_size_t), ('peak_process', c.c_size_t), ('peak_job', c.c_size_t)]

create_job = bind(k, 'CreateJobObjectW', w.HANDLE, P, w.LPCWSTR)
set_job = bind(k, 'SetInformationJobObject', w.BOOL, w.HANDLE, c.c_int, P, D)
assign = bind(k, 'AssignProcessToJobObject', w.BOOL, w.HANDLE, w.HANDLE)
terminate = bind(k, 'TerminateJobObject', w.BOOL, w.HANDLE, w.UINT)

class Job:
    def __init__(self, child):
        self.handle = create_job(None, None)
        limit = Limits(); limit.basic.flags = 0x2000
        if not self.handle or not set_job(self.handle, 9, c.byref(limit), c.sizeof(limit)) or not assign(self.handle, w.HANDLE(int(child._handle))):
            self.close(); child.kill(); child.wait(); fail()
    def stop(self):
        if not terminate(self.handle, 1): fail()
    def close(self):
        if self.handle: close(self.handle); self.handle = None
