// [INPUT]: 已认证解压后的 tar 流、成员声明和私有暂存 JSON 文件。
// [OUTPUT]: 内容/实际流/成员/路径/元数据的独立资源上限，超限显式报错而不冒充 EOF。
// [POS]: 普通身份归档的资源边界；保留 GNU 长路径、PAX size 和旧 gzip/Zstd 格式。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use std::{
    fs,
    io::{self, Read},
    path::Path,
};
use zeroize::Zeroizing;

pub(super) const ERROR: &str = "身份归档超过安全资源上限。";

#[derive(Clone, Copy)]
pub(super) struct Limits {
    pub members: usize,
    pub path_bytes: usize,
    pub member_bytes: u64,
    pub content_bytes: u64,
    pub stream_bytes: u64,
    pub manifest_bytes: u64,
    pub config_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        const MEMBERS: usize = 100_000;
        const PATH: usize = 4096;
        const CONTENT: u64 = 8 * 1024 * 1024 * 1024;
        Self {
            members: MEMBERS,
            path_bytes: PATH,
            member_bytes: CONTENT,
            content_bytes: CONTENT,
            // The supported 8 GiB is member content. Allow each member's header,
            // padding and a maximum GNU long-name extension, plus tar terminators.
            // This also bounds PAX metadata and all decompressed trailing bytes.
            stream_bytes: CONTENT + MEMBERS as u64 * (PATH as u64 + 4 * 512) + 1024,
            manifest_bytes: 1024 * 1024,
            config_bytes: 64 * 1024 * 1024,
        }
    }
}

fn exceeded() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, ERROR)
}

pub(super) fn problem(error: impl std::fmt::Display) -> String {
    if error.to_string().contains(ERROR) {
        ERROR.into()
    } else if error.to_string().contains("身份归档包含链接或特殊文件。") {
        "身份归档包含链接或特殊文件。".into()
    } else {
        super::store::problem(error)
    }
}

pub(super) fn read_file(path: &Path, maximum: u64) -> Result<Zeroizing<Vec<u8>>, String> {
    let file = fs::File::open(path).map_err(problem)?;
    let length = file.metadata().map_err(problem)?.len();
    if length > maximum {
        return Err(ERROR.into());
    }
    let capacity = length.saturating_add(1).min(usize::MAX as u64) as usize;
    let mut bytes = Zeroizing::new(Vec::with_capacity(capacity));
    file.take(maximum.saturating_add(1))
        .read_to_end(&mut *bytes)
        .map_err(problem)?;
    if bytes.len() as u64 > maximum {
        return Err(ERROR.into());
    }
    Ok(bytes)
}

/// Transparent preallocation guard in front of tar's GNU/PAX preprocessing.
/// Only framing is inspected here; tar retains checksum/path/format validation.
pub(super) struct TarRead<R> {
    input: R,
    limits: Limits,
    remaining: u64,
    header: [u8; 512],
    header_at: usize,
    payload: u64,
    metadata: Option<Vec<u8>>,
    metadata_left: u64,
    pax_size: Option<u64>,
    members: usize,
    extensions: usize,
    content: u64,
    trailing: bool,
}

impl<R: Read> TarRead<R> {
    pub(super) fn new(input: R, limits: Limits) -> Self {
        Self {
            input,
            limits,
            remaining: limits.stream_bytes,
            header: [0; 512],
            header_at: 512,
            payload: 0,
            metadata: None,
            metadata_left: 0,
            pax_size: None,
            members: 0,
            extensions: 0,
            content: 0,
            trailing: false,
        }
    }

    fn read_bounded(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if self.remaining == 0 {
            // Do not turn a resource limit into a successful EOF. The probe also
            // reaches the compression checksum and authenticated encryption tail.
            return match self.input.read(&mut [0; 1])? {
                0 => Ok(0),
                _ => Err(exceeded()),
            };
        }
        let count = output
            .len()
            .min(self.remaining.min(usize::MAX as u64) as usize);
        let read = self.input.read(&mut output[..count])?;
        self.remaining -= read as u64;
        Ok(read)
    }

    fn next_header(&mut self) -> io::Result<bool> {
        if let Some(bytes) = self.metadata.take() {
            // Match tar's first numeric PAX size lookup, including invalid values.
            self.pax_size = None;
            for extension in tar::PaxExtensions::new(&bytes) {
                let Ok(extension) = extension else { break };
                if extension.key() == Ok("size") {
                    self.pax_size = extension.value().ok().and_then(|s| s.parse().ok());
                    break;
                }
            }
        }
        let mut header = [0; 512];
        let mut filled = 0;
        while filled < header.len() {
            let count = self.read_bounded(&mut header[filled..])?;
            if count == 0 {
                if filled == 0 {
                    return Ok(false);
                }
                return Err(io::ErrorKind::UnexpectedEof.into());
            }
            filled += count;
        }
        if header.iter().all(|byte| *byte == 0) {
            self.trailing = true;
        } else {
            let parsed = tar::Header::from_byte_slice(&header);
            let kind = parsed.entry_type();
            let recognized = parsed.as_gnu().is_some() || parsed.as_ustar().is_some();
            let long_name = recognized && (kind.is_gnu_longname() || kind.is_gnu_longlink());
            let pax = recognized && kind.is_pax_local_extensions();
            let extension = long_name || pax;
            let size = if extension {
                parsed.entry_size()?
            } else {
                self.pax_size.take().unwrap_or(parsed.entry_size()?)
            };
            if extension {
                self.extensions = self.extensions.checked_add(1).ok_or_else(exceeded)?;
                if self.extensions > self.limits.members.saturating_mul(2)
                    || size
                        > if long_name {
                            self.limits.path_bytes as u64 + 1
                        } else {
                            self.limits.manifest_bytes
                        }
                {
                    return Err(exceeded());
                }
                if pax {
                    self.metadata = Some(Vec::new());
                    self.metadata_left = size;
                }
            } else {
                if !kind.is_file() && !kind.is_dir() {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "身份归档包含链接或特殊文件。",
                    ));
                }
                self.members = self.members.checked_add(1).ok_or_else(exceeded)?;
                self.content = self.content.checked_add(size).ok_or_else(exceeded)?;
                if self.members > self.limits.members
                    || size > self.limits.member_bytes
                    || self.content > self.limits.content_bytes
                    || parsed.path_bytes().len() > self.limits.path_bytes
                    || (parsed.path_bytes().as_ref() == b"manifest.json"
                        && size > self.limits.manifest_bytes)
                {
                    return Err(exceeded());
                }
            }
            self.payload = size.checked_add(511).ok_or_else(exceeded)? / 512 * 512;
            if self.payload > self.remaining {
                return Err(exceeded());
            }
        }
        self.header = header;
        self.header_at = 0;
        Ok(true)
    }
}

impl<R: Read> Read for TarRead<R> {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        if self.header_at < 512 {
            let count = output.len().min(512 - self.header_at);
            output[..count].copy_from_slice(&self.header[self.header_at..self.header_at + count]);
            self.header_at += count;
            return Ok(count);
        }
        if self.trailing {
            return self.read_bounded(output);
        }
        if self.payload > 0 {
            let count = output
                .len()
                .min(self.payload.min(usize::MAX as u64) as usize);
            let count = self.read_bounded(&mut output[..count])?;
            if count == 0 {
                return Err(io::ErrorKind::UnexpectedEof.into());
            }
            if let Some(metadata) = &mut self.metadata {
                let used = count.min(self.metadata_left as usize);
                metadata.extend_from_slice(&output[..used]);
                self.metadata_left -= used as u64;
            }
            self.payload -= count as u64;
            return Ok(count);
        }
        if !self.next_header()? {
            return Ok(0);
        }
        self.read(output)
    }
}

#[cfg(test)]
#[path = "archive_limits_tests.rs"]
mod tests;
